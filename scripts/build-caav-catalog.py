"""Build and verify the browser-ready CAAV stimulus catalog.

Requires Python 3, openpyxl, ffprobe, the official aggregate CAAV workbook,
and the checked-in source manifests. The source MPG files are optional: when
present, their recorded hashes are verified before they are removed from the
public Pages tree.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[1]
CAAV = ROOT / "site" / "assets" / "research-stimuli" / "caav" / "v1"
METADATA = CAAV / "metadata"
MEDIA = CAAV / "media"
RATINGS = CAAV / "ratings"
ORIGINAL_RATINGS = RATINGS / "original"
ORIGINAL_METADATA = METADATA / "original"
SOURCE = CAAV / "source"
CATALOG = CAAV / "catalog.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def file_record(path: Path, public_path: str) -> dict[str, object]:
    return {
        "path": public_path,
        "byteLength": path.stat().st_size,
        "sha256": sha256(path),
    }


def probe(path: Path) -> dict[str, object]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames,duration",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            "--",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)
    videos = [stream for stream in payload["streams"] if stream["codec_type"] == "video"]
    audios = [stream for stream in payload["streams"] if stream["codec_type"] == "audio"]
    if len(videos) != 1 or audios:
        raise ValueError(f"Expected one video stream and no audio streams: {path}")
    video = videos[0]
    if (
        video["codec_name"] != "h264"
        or video["width"] != 1920
        or video["height"] != 1080
        or video["r_frame_rate"] != "30/1"
    ):
        raise ValueError(f"Unexpected browser media profile: {path}: {video}")
    return {
        "mimeType": "video/mp4",
        "codec": "H.264/AVC",
        "width": video["width"],
        "height": video["height"],
        "frameRate": 30,
        "frameCount": int(video["nb_frames"]),
        "durationSeconds": round(float(payload["format"]["duration"]), 6),
        "audio": False,
    }


def rounded(value: object) -> float:
    return round(float(value), 6)


def rating(mean: object, standard_deviation: object) -> dict[str, float]:
    original = rounded(mean)
    return {
        "meanSam1To9": original,
        "standardDeviationSam1To9": rounded(standard_deviation),
        "meanAffectTrackerMinus1To1": round((original - 5.0) / 4.0, 6),
    }


def load_ratings() -> dict[str, tuple[object, ...]]:
    workbook = load_workbook(ORIGINAL_RATINGS / "CAAV_Dataset.xlsx", read_only=True, data_only=True)
    worksheet = workbook["CAAV_Rating"]
    rows = worksheet.iter_rows(values_only=True)
    next(rows)  # merged workbook title
    headers = next(rows)
    expected = (
        "Video_ID",
        "Action_description",
        "POV",
        "Gender",
        "V_M_Tot",
        "V_SD_Tot",
        "A_M_Tot",
        "A_SD_Tot",
        "V_M_Fem",
        "V_SD_Fem",
        "V_M_Mal",
        "V_SD_Mal",
        "A_M_Fem",
        "A_SD_Fem",
        "A_M_Mal",
        "A_SD_Mal",
    )
    if headers != expected:
        raise ValueError(f"Unexpected CAAV workbook columns: {headers}")
    return {str(row[0]): row for row in rows if row[0]}


def main() -> None:
    if shutil.which("ffprobe") is None:
        raise RuntimeError("ffprobe is required to validate the browser derivatives")

    primary_rows = json.loads((METADATA / "primary-source-manifest.json").read_text("utf-8"))
    primary = {row["videoId"]: row for row in primary_rows}
    samples_payload = json.loads((METADATA / "published-sample-manifest.json").read_text("utf-8"))
    samples = {row["videoId"]: row for row in samples_payload["samples"]}
    ratings = load_ratings()
    hosted_ids = sorted(primary.keys() | samples.keys())

    if len(primary) != 90 or len(hosted_ids) != 96:
        raise ValueError(f"Expected 90 primary and 96 total clips, got {len(primary)} and {len(hosted_ids)}")

    clips: list[dict[str, object]] = []
    for video_id in hosted_ids:
        row = ratings.get(video_id)
        if row is None:
            raise ValueError(f"No normative rating row for {video_id}")
        media_name = f"caav__{video_id.lower().replace('_', '-')}__h264-1080p.mp4"
        media_path = MEDIA / media_name
        if not media_path.is_file():
            raise FileNotFoundError(media_path)
        browser = file_record(media_path, f"media/{media_name}")
        browser.update(probe(media_path))

        source: dict[str, object] = {
            "archiveUrl": "https://springernature.figshare.com/articles/dataset/CAAV_database/11215067",
            "archiveFileId": 19808720,
            "archiveMember": f"CAAV_dataset/{video_id}.mpg",
        }
        if video_id in primary:
            recorded = primary[video_id]
            if browser["byteLength"] != recorded["mediaByteLength"] or browser["sha256"] != recorded["mediaSha256"]:
                raise ValueError(f"Browser derivative no longer matches its primary manifest: {video_id}")
            source.update(
                {
                    "byteLength": recorded["sourceByteLength"],
                    "crc32": recorded["sourceCrc32"],
                    "sha256": recorded["sourceSha256"],
                }
            )
        if video_id in samples:
            sample = samples[video_id]
            source["publishedSample"] = {
                key: sample[key]
                for key in ("articleId", "fileId", "doi", "sourceUrl", "downloadUrl", "byteLength", "md5", "sha256")
            }
            source.setdefault("byteLength", sample["byteLength"])
            source.setdefault("sha256", sample["sha256"])
            local_source = SOURCE / f"{video_id}.mpg"
            if local_source.exists():
                if local_source.stat().st_size != sample["byteLength"] or sha256(local_source) != sample["sha256"]:
                    raise ValueError(f"Downloaded published sample failed verification: {video_id}")

        clips.append(
            {
                "id": video_id,
                "action": str(row[1]).strip(),
                "condition": {"pointOfView": int(row[2]), "actorGender": row[3]},
                "ratings": {
                    "overall": {
                        "valence": rating(row[4], row[5]),
                        "arousal": rating(row[6], row[7]),
                    },
                    "femaleParticipants": {
                        "valence": rating(row[8], row[9]),
                        "arousal": rating(row[12], row[13]),
                    },
                    "maleParticipants": {
                        "valence": rating(row[10], row[11]),
                        "arousal": rating(row[14], row[15]),
                    },
                },
                "media": browser,
                "source": source,
            }
        )

    aggregate = ORIGINAL_RATINGS / "CAAV_Dataset.xlsx"
    raw = ORIGINAL_RATINGS / "CAAV_RawData.xlsx"
    study = ORIGINAL_METADATA / "CAAV_Study_Characteristics.xlsx"
    catalog = {
        "schema": "org.aliusresearch.affect-stimulus-catalog",
        "version": 1,
        "generatedDate": "2026-09-10",
        "dataset": {
            "name": "Chieti Affective Action Video (CAAV)",
            "shortName": "CAAV",
            "doi": "10.1038/s41597-020-0366-1",
            "sourceUrl": "https://springernature.figshare.com/articles/dataset/CAAV_database/11215067",
            "validationPaperUrl": "https://www.nature.com/articles/s41597-020-0366-1",
            "license": {
                "name": "CC0 1.0",
                "url": "https://creativecommons.org/publicdomain/zero/1.0/",
            },
            "participantCount": 444,
            "publishedClipCount": 360,
            "publishedActionCount": 90,
        },
        "hostedSubset": {
            "clipCount": len(clips),
            "distinctActionCount": len({clip["action"] for clip in clips}),
            "primaryCondition": {
                "clipCount": len(primary),
                "pointOfView": 1,
                "actorGender": "F",
                "selectionReason": "Maximizes distinct actions while holding camera perspective and actor condition constant.",
            },
            "additionalPublishedSamples": len(set(hosted_ids) - primary.keys()),
            "intendedUse": "Researcher-selected clip-level convergent validation of AffectTracker2D valence and arousal coordinates.",
            "qualificationBoundary": "CAAV norms are retrospective post-clip ratings, not continuous time-series ground truth.",
        },
        "ratingScale": {
            "instrument": "Self-Assessment Manikin (SAM)",
            "originalRange": {"minimum": 1, "neutral": 5, "maximum": 9},
            "affectTrackerRange": {"minimum": -1, "neutral": 0, "maximum": 1},
            "transform": "(SAM - 5) / 4",
        },
        "browserDerivative": {
            "sourceFormat": "MPEG program stream with MPEG-1 video; source audio intentionally omitted",
            "format": "MP4",
            "videoCodec": "H.264/AVC",
            "pixelFormat": "yuv420p",
            "dimensions": "1920x1080",
            "nominalFrameRate": 30,
            "audio": False,
            "ffmpegRecipe": "ffmpeg -i INPUT -map 0:v:0 -an -c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p -movflags +faststart -fps_mode passthrough -map_metadata -1 OUTPUT.mp4",
            "notice": "These are lossy browser-compatible derivatives. Use each media SHA-256 for exact study-version binding.",
        },
        "ratingsNotice": "The official raw workbook and CSV exports contain pseudonymous subject labels, age, gender, list assignment, and sparse 1-9 ratings. They are publicly released by CAAV under CC0, but researchers must still handle participant-level data responsibly and use aggregate norms unless row-level analysis is necessary.",
        "includedRatings": [
            file_record(aggregate, "ratings/original/CAAV_Dataset.xlsx"),
            file_record(raw, "ratings/original/CAAV_RawData.xlsx"),
            file_record(RATINGS / "caav__clip-norms__sam-1-9.csv", "ratings/caav__clip-norms__sam-1-9.csv"),
            file_record(RATINGS / "caav__raw-valence__sam-1-9.csv", "ratings/caav__raw-valence__sam-1-9.csv"),
            file_record(RATINGS / "caav__raw-arousal__sam-1-9.csv", "ratings/caav__raw-arousal__sam-1-9.csv"),
        ],
        "includedMetadata": [
            file_record(study, "metadata/original/CAAV_Study_Characteristics.xlsx"),
        ],
        "upstreamOnly": [
            {
                "name": "Complete 360-video source archive",
                "url": "https://ndownloader.figshare.com/files/19808720",
                "byteLength": 6137735504,
                "md5": "f8e42e2e6d8eb8b6e46ec43b151e8840",
                "reason": "Not mirrored because it alone exceeds the GitHub Pages 1 GB published-site limit.",
            },
        ],
        "clips": clips,
    }
    CATALOG.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {CATALOG} with {len(clips)} verified clips")


if __name__ == "__main__":
    main()
