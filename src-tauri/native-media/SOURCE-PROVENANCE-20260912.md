# GStreamer 1.28.6 source provenance evidence — 2026-09-12

## Result and allocation

The six source archives named by the runtime pin have been located, downloaded
sequentially, retained outside Git, and verified against both their pinned and
upstream SHA-256 values. This supplies candidate evidence for the pin's four
listed factual omissions: archive names, URLs, lengths, and retained copies.
It does **not** close corresponding-source coverage for the complete staged
runtime, authenticate upstream signatures, or approve redistribution.

This is the coordinator-allocated RR04 / E2E-RUNNER provenance evidence pass,
following the frozen P7 writer handoff. Its bounded deliverable is this additive
document. It collects source metadata, archive integrity, license-text and
source-target observations now; complete dependency closure, packaging changes,
legal/distribution review, and installed playback qualification are deferred to
their owners. No experiment function, input, recipe JSON, schema, native
authority, or platform support changes in this pass.

Audited repository base: `460f51600298db910a52b25f25e8268dd722569b`.
The [runtime pin](./gstreamer-runtime-v1.json), capability flags, existing ledgers,
and runtime files are unchanged. Pin SHA-256:
`a1c3c2339647895b2c067c350ece9fc21c2537579d11166ca02d84b25e67f522`.
Its existing `sourceEvidence.status = incomplete-not-for-distribution`,
`automatedFetchAndVerification = false`, and `distributionApproved = false`
remain authoritative. An external audit script is not an integrated release gate.

## Retained official source archives

Observed on 2026-09-12 UTC. Each archive URL returned HTTP 200; its actual byte
length matched HEAD and its computed SHA-256 matched the pin and the linked
upstream checksum. The six bodies total **19,314,344 bytes**. They were not built
or executed. Root `COPYING` and ten Meson files were read directly from the
archives without extracting a source tree into the repository.

| Official archive | Bytes | SHA-256 | Published checksum |
| --- | ---: | --- | --- |
| [gstreamer-1.28.6.tar.xz](https://gstreamer.freedesktop.org/src/gstreamer/gstreamer-1.28.6.tar.xz) | 1,955,504 | `62b6b9f0ad3147a6dd6420ac64a91180b14e990695bddd353b96041611d052ca` | [SHA-256](https://gstreamer.freedesktop.org/src/gstreamer/gstreamer-1.28.6.tar.xz.sha256sum) |
| [gst-plugins-base-1.28.6.tar.xz](https://gstreamer.freedesktop.org/src/gst-plugins-base/gst-plugins-base-1.28.6.tar.xz) | 2,553,864 | `0ba699c7c6c66f4ba640be78cb38a24715add9683f3e3a199f5369dc5a4f04ac` | [SHA-256](https://gstreamer.freedesktop.org/src/gst-plugins-base/gst-plugins-base-1.28.6.tar.xz.sha256sum) |
| [gst-plugins-good-1.28.6.tar.xz](https://gstreamer.freedesktop.org/src/gst-plugins-good/gst-plugins-good-1.28.6.tar.xz) | 5,999,116 | `b0c620a4b18b6ee931b4c43bbf1760d308666dc37f730a7e7f1ad327e59ce2df` | [SHA-256](https://gstreamer.freedesktop.org/src/gst-plugins-good/gst-plugins-good-1.28.6.tar.xz.sha256sum) |
| [gst-plugins-bad-1.28.6.tar.xz](https://gstreamer.freedesktop.org/src/gst-plugins-bad/gst-plugins-bad-1.28.6.tar.xz) | 8,343,524 | `6636f2c2289ceda52c4aba971338c81e2b5780d3381bd3673c1c116ec87587c3` | [SHA-256](https://gstreamer.freedesktop.org/src/gst-plugins-bad/gst-plugins-bad-1.28.6.tar.xz.sha256sum) |
| [gst-plugins-ugly-1.28.6.tar.xz](https://gstreamer.freedesktop.org/src/gst-plugins-ugly/gst-plugins-ugly-1.28.6.tar.xz) | 243,628 | `ee279da13a740fd7f060d631a673223fa3bcc8c33d350c8d0264bd332a24ecd8` | [SHA-256](https://gstreamer.freedesktop.org/src/gst-plugins-ugly/gst-plugins-ugly-1.28.6.tar.xz.sha256sum) |
| [gst-libav-1.28.6.tar.xz](https://gstreamer.freedesktop.org/src/gst-libav/gst-libav-1.28.6.tar.xz) | 218,708 | `71e6eafb4fff2a66d1bb0ba8d078224dfe7e3397307d8c0bba3dc23606e08f51` | [SHA-256](https://gstreamer.freedesktop.org/src/gst-libav/gst-libav-1.28.6.tar.xz.sha256sum) |

Each archive also has a fetched `.asc` sibling, recorded in
`source-metadata.json`. Signature bytes were retained, but no key trust or
cryptographic signature verification was performed. Matching a checksum served
by the same upstream endpoint demonstrates consistency, not independently
authenticated release provenance.

Each archive's root `COPYING` contains the GNU Lesser General Public License,
version 2.1 text. Exact retained license-text fingerprints are:

| Archives sharing the root COPYING bytes | Bytes | SHA-256 |
| --- | ---: | --- |
| gstreamer, gst-plugins-base, gst-libav | 26,431 | `ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db` |
| gst-plugins-good, gst-plugins-ugly | 26,432 | `6095e9ffa777dd22839f7801aa845b31c9ed07f3d6bf8a26dc5d2dec8ccc0ef3` |
| gst-plugins-bad | 26,530 | `dc626520dcd53a22f727af3ee42c770e56c97a64fe3adb063799d8ab032fe551` |

This identifies included license text; it does not assign a single license to
every file, plugin, or linked dependency. The six tagged Cerbero recipes use
`License.LGPLv2Plus`, inherited from `custom.GStreamer` or declared explicitly.
The tagged [license enum](https://github.com/GStreamer/cerbero/blob/59548269f4fd0f701818f0bafdb102959ec81e65/cerbero/enums.py#L289)
maps that label to `LGPL-2.0-or-later`. The distinction between a packaged license
text and a particular source-file grant needs to survive the eventual license
inventory. External plugin dependencies require separate analysis, as explained
in the [upstream licensing FAQ](https://gstreamer.freedesktop.org/documentation/frequently-asked-questions/licensing.html).

## Installer and build-recipe identity

The pinned [Windows installer](https://gstreamer.freedesktop.org/data/pkg/windows/1.28.6/msvc/gstreamer-1.0-msvc-x86_64-1.28.6.exe)
returned HEAD 200 with **528,572,178 bytes**. Its fetched
[published checksum](https://gstreamer.freedesktop.org/data/pkg/windows/1.28.6/msvc/gstreamer-1.0-msvc-x86_64-1.28.6.exe.sha256sum)
matches the pin:
`059251444d1267b486eba390b18d25fed87e10315e72f757ec6c7e912fa746b5`.
The installer body was not downloaded or rehashed in this pass.

The [official Cerbero mirror](https://github.com/GStreamer/cerbero) identifies
its upstream as the GStreamer GitLab repository. Its
[1.28.6 tag reference](https://api.github.com/repos/GStreamer/cerbero/git/ref/tags/1.28.6)
resolved through annotated tag `78666745b34b6245a85510ac47a03a5033af4711`
to commit **`59548269f4fd0f701818f0bafdb102959ec81e65`**. The tag object and complete,
non-truncated tree response are retained. The tag's signature was not verified.
All recipe links in this report use that exact commit.

This is a candidate build-recipe identity, not an attestation that the pinned
installer was built from precisely that commit and configuration. The
[GStreamer recipe base](https://github.com/GStreamer/cerbero/blob/59548269f4fd0f701818f0bafdb102959ec81e65/recipes/custom.py) uses release tarballs in
release CI, but also supports source-selection behavior affected by build
context and manifests. The actual installer job's source manifest, toolchain,
variants, package selections, and applied patches remain to be bound to its hash.

The tagged [package composition](https://github.com/GStreamer/cerbero/blob/59548269f4fd0f701818f0bafdb102959ec81e65/packages/gstreamer-1.0/gstreamer-1.0.package)
includes optional GPL/restricted codec and other feature groups. The
[Inno Setup generator](https://github.com/GStreamer/cerbero/blob/59548269f4fd0f701818f0bafdb102959ec81e65/cerbero/packages/windows/inno_setup.py)
distinguishes runtime/development/custom selections and displays an installer
license file. Neither a default package selection nor the installer license UI
establishes notice/source completeness in the application's copied runtime tree.

## Staged runtime and source-target mapping

The audited pin's `runtime-files.sha256` has SHA-256
`51c27b6a25db1d86dea20cc108e88240fc340758b34ae1e497dd91d8de1b5566`.
This pass directly rehashed that manifest and statted every listed file:
**827 files, 340,362,958 bytes**, including **146 DLLs under `bin/`** and
**271 DLLs under `lib/gstreamer-1.0/`**. Top-level file counts are `bin: 170`,
`etc: 24`, `lib: 551`, `libexec: 2`, `share: 79`, plus the project notice.
Per-file digests in `runtime-inventory.json` come from the verified manifest;
this pass did not independently rehash all runtime binary bodies.

Only `GSTREAMER-RUNTIME-NOTICE.txt` has a basename containing `license`, `copying`,
or `notice` in that manifest. That is a filename-inventory finding, not a claim
about all embedded text. The project notice does not supply a collected
per-component third-party notice/license set.

The following ten required PE files have matching build-target declarations in
the retained archives. Member existence, member SHA-256, declaration snippets,
and runtime manifest digest/length are retained in `runtime-inventory.json`.
Archive versions below are all 1.28.6. These are source-target mappings;
compiler inputs and binary correspondence still need the build evidence above.

| Staged relative path | Source archive component | Archive-relative Meson file |
| --- | --- | --- |
| `bin/gstreamer-1.0-0.dll` | `gstreamer` | `gst/meson.build` |
| `bin/gstplay-1.0-0.dll` | `gst-plugins-bad` | `gst-libs/gst/play/meson.build` |
| `bin/gstvideo-1.0-0.dll` | `gst-plugins-base` | `gst-libs/gst/video/meson.build` |
| `bin/gstpbutils-1.0-0.dll` | `gst-plugins-base` | `gst-libs/gst/pbutils/meson.build` |
| `libexec/gstreamer-1.0/gst-plugin-scanner.exe` | `gstreamer` | `libs/gst/helpers/meson.build` |
| `lib/gstreamer-1.0/gstcoreelements.dll` | `gstreamer` | `plugins/elements/meson.build` |
| `lib/gstreamer-1.0/gstplayback.dll` | `gst-plugins-base` | `gst/playback/meson.build` |
| `lib/gstreamer-1.0/gstd3d11.dll` | `gst-plugins-bad` | `sys/d3d11/meson.build` |
| `lib/gstreamer-1.0/gstwasapi2.dll` | `gst-plugins-bad` | `sys/wasapi2/meson.build` |
| `lib/gstreamer-1.0/gstlibav.dll` | `gst-libav` | `ext/libav/meson.build` |

## Dependencies outside the six retained archives

These are **candidate sources declared by the tagged recipes**, supported by
matching staged library/plugin names. Their archive bodies, byte lengths,
license texts, patches, and binary correspondence have not been verified in this
pass. This table is a prioritized gap list, not a complete SBOM. License labels
describe upstream recipe declarations, not a distribution approval.

| Staged evidence | Tagged candidate source and license declaration | Remaining source detail |
| --- | --- | --- |
| `ges-1.0-0.dll`, `gstges.dll`, `gstnle.dll` | [gst-editing-services-1.0](https://github.com/GStreamer/cerbero/blob/59548269f4fd0f701818f0bafdb102959ec81e65/recipes/gst-editing-services-1.0.recipe): 1.28.6, LGPL-2.0-or-later inherited | Separate `gst-editing-services` archive; depends on devtools and other modules. |
| `gstrtspserver-1.0-0.dll`, `gstrtspclientsink.dll` | [gst-rtsp-server-1.0](https://github.com/GStreamer/cerbero/blob/59548269f4fd0f701818f0bafdb102959ec81e65/recipes/gst-rtsp-server-1.0.recipe): 1.28.6, LGPL-2.0-or-later inherited | Separate `gst-rtsp-server` archive. |
| `gstvalidate-1.0-0.dll` and validate tools | [gst-devtools-1.0](https://github.com/GStreamer/cerbero/blob/59548269f4fd0f701818f0bafdb102959ec81e65/recipes/gst-devtools-1.0.recipe): 1.28.6, LGPL-2.0-or-later inherited | Separate `gst-devtools` archive plus `json-glib` and other dependencies. |
| `avcodec-61.dll`, `avformat-61.dll`, `avutil-59.dll`, related FFmpeg DLLs | [ffmpeg](https://github.com/GStreamer/cerbero/blob/59548269f4fd0f701818f0bafdb102959ec81e65/recipes/ffmpeg.recipe): 7.1, LGPL-2.1-or-later | Two declared patches: Meson port and text-relocation fix; actual configuration and dependencies. `gst-libav` is the wrapper source, not FFmpeg's source. |
| `glib-2.0-0.dll`, `gio-2.0-0.dll`, `gobject-2.0-0.dll` | [glib](https://github.com/GStreamer/cerbero/blob/59548269f4fd0f701818f0bafdb102959ec81e65/recipes/glib.recipe): 2.82.4, LGPL-2.0-or-later | Fourteen declared patches; `libffi`, `zlib`, `pcre2` and actual build options. |
| `gtk-4-1.dll` | [gtk](https://github.com/GStreamer/cerbero/blob/59548269f4fd0f701818f0bafdb102959ec81e65/recipes/gtk.recipe): 4.20.3, LGPL-2.1-or-later | No patches in this recipe; graphics/font/image libraries and their transitive sources remain. |
| `x264-164.dll`, `gstx264.dll` | [x264](https://github.com/GStreamer/cerbero/blob/59548269f4fd0f701818f0bafdb102959ec81e65/recipes/x264.recipe): 0.164.3108+git31e19f9, GPL-2.0-or-later | Three declared patches, including the Meson port; archive alone is insufficient. |
| `x265.dll`, `gstx265.dll` | [x265](https://github.com/GStreamer/cerbero/blob/59548269f4fd0f701818f0bafdb102959ec81e65/recipes/x265.recipe): 3.6, GPL-2.0-or-later | Seven declared patches and linked 10-bit/12-bit builds must be covered. |
| Rust plugins including `gstreqwest.dll`, `gstthreadshare.dll`, `gstwebrtchttp.dll` | [gst-plugins-rs](https://github.com/GStreamer/cerbero/blob/59548269f4fd0f701818f0bafdb102959ec81e65/recipes/gst-plugins-rs.recipe): 0.15.3, release Git ref `gstreamer-1.28.6`; per-plugin Apache-2.0 / MIT / LGPL-2.1-or-later declarations | Resolve the Git ref to a commit, retain its exact source plus selected Cargo dependency/feature closure and licenses; a C-plugin tarball does not contain this closure. |
| OpenSSL, curl, image/font/compression/codec DLLs, `libgcc_s_seh-1.dll`, `libstdc++-6.dll`, `libwinpthread-1.dll`, remaining runtime files | Full path/digest/length inventory is retained; component mapping remains open | Identify every shipped component, static inclusion, patches, generated inputs, runtime support libraries, source location, license/exception and required notices. |

Recipe-declared source identities for the highest-priority missing archives are
listed below. URLs are declarations expanded only where the recipe supplies an
HTTP template; `gnome://` remains unresolved in this evidence. These are not
additional downloaded/verified artifacts.

| Component | Declared archive location | Recipe-declared SHA-256 |
| --- | --- | --- |
| FFmpeg 7.1 | `https://ffmpeg.org/releases/ffmpeg-7.1.tar.xz` | `40973d44970dbc83ef302b0609f2e74982be2d85916dd2ee7472d30678a7abe6` |
| GLib 2.82.4 | `gnome://glib/2.82/glib-2.82.4.tar.xz` | `37dd0877fe964cd15e9a2710b044a1830fb1bd93652a6d0cb6b8b2dff187c709` |
| GTK 4.20.3 | `gnome://` recipe shorthand; canonical archive URL unresolved | `2873f2903088a66c71173ea2ed85ffae266a66b972c3a4842bbb2f6f187ec153` |
| x264 0.164.3108+git31e19f9 | `https://gstreamer.freedesktop.org/src/mirror/x264_0.164.3108+git31e19f9.orig.tar.gz` | `41606cb8e788a7f8c4514290646d4ba5c7bc68d9e1ccd1a73f446a90546913eb` |
| x265 3.6 | `https://bitbucket.org/multicoreware/x265_git/downloads/x265_3.6.tar.gz` | `663531f341c5389f460d730e62e10a4fcca3428ca2ca109693867bc5fe2e2807` |
| gst-editing-services 1.28.6 | GStreamer release-template source; archive endpoint unverified here | `3d151e5097d686c5890ae76f14c57ee19538fd61c6cf637171f90b309cafd53c` |
| gst-rtsp-server 1.28.6 | GStreamer release-template source; archive endpoint unverified here | `0cb725b1351f75e88803c55dddea1f27be09523ddcd7f29ab18270e182a2a463` |
| gst-devtools 1.28.6 | GStreamer release-template source; archive endpoint unverified here | `14d41faae03619251f95959d3d57bf65c6106838b3b54218dc95c7135e1eba13` |

## Minimal remaining gate evidence

1. **Bind the installer to its build.** Retain the exact Cerbero commit, build
   manifest, MSVC/toolchain configuration, enabled variants, package selections,
   patches and generated inputs tied to the pinned installer. Establish upstream
   release authenticity using a reviewed trust basis; fetched signatures alone
   do not meet that need.
2. **Close the shipped component inventory.** Map every staged file and statically
   included component to a source recipe/version/commit and license/notice set.
   Resolve the candidates above and all remaining dependencies, including Rust
   crates and toolchain runtime components. File names are discovery evidence,
   not a substitute for this mapping.
3. **Retain the complete corresponding source and build material.** Verify exact
   archive names, canonical URLs, lengths and hashes; retain patches, Git/Cargo
   dependencies and relevant build configuration. Put the artifacts under durable
   release retention with a reproducible manifest and an identified source
   delivery mechanism. The six local archives are only the first subset.
4. **Review the actual distribution package.** Assess the resulting license
   obligations, notices, source delivery and applicable replacement/relinking
   requirements against the chosen packaging and licenses. Record the responsible
   reviewer and approved component scope. Decide any codec/plugin reduction as
   a separate change with a new tree manifest and applicable qualification.
5. **Integrate and qualify through the existing owners.** A subsequent allocated
   change can consume the evidence into the pin/release checks. Preserve the
   fail-closed capability until all claim-specific gates are met. Native adapter
   auditing, installed playback/format validation and Runner qualification remain
   separate; this document supplies none of those receipts.

### Practical next slice toward a reviewed minimal runtime

Produce a review-only closure proposal against the unchanged 827-file manifest.
Use the ten required PE files above as initial roots, then add the parsers,
demuxers, decoders, converters, sinks and resources required by the charter's
existing media/format targets. Ten required files are not a complete playback
closure. Combine static PE dependency analysis with the native diagnostic owner's
isolated plugin/format observations to capture dynamically selected dependencies.

The next slice should deliver three concrete evidence artifacts (proposed names;
none is produced by this audit): `runtime-closure-candidate.json`, mapping each
current file to retain/remove/unresolved with a dependency or format-test reason;
`runtime-source-lock-candidate.json`, binding every retained component to source,
patch, toolchain and license evidence; and `runtime-closure-review.md`, recording
coverage of every existing target and unresolved review items. Prioritize the
GstPlay/core/base/bad/libav, FFmpeg and GLib chain. GTK, Rust plugins, editing/RTSP/
validation tools, encoders and their dependencies are review candidates only;
remove nothing until dependency and target coverage justify it. Reuse the six
retained sources and request only the next necessary archive group after that
map is reviewed. Any accepted reduction needs a separately allocated staging/pin
change, notice/source package and complete applicable qualification; it cannot
silently narrow supported media or platform targets.

The exact tagged [Cerbero `bundle-source` implementation](https://github.com/GStreamer/cerbero/blob/59548269f4fd0f701818f0bafdb102959ec81e65/cerbero/commands/bundlesource.py)
collects selected package/recipe dependencies and normally bootstrap source
directories. It is a candidate collection mechanism after the actual build
configuration is known, not proof of completeness by itself. It was not run
here; in particular, Cargo vendoring and all selected source directories still
need inspection. A guessed upstream `cerbero-1.28.6.tar.xz` endpoint returned
404, so no prebuilt corresponding-source bundle is claimed.

The blind-spot pass also checked the [official 1.28 release history](https://gstreamer.freedesktop.org/releases/1.28/):
1.28.6 was released on 2026-08-05, and 1.28.7 on 2026-09-07. This report audits
the authorized 1.28.6 pin; it is not a vulnerability assessment or upgrade
approval. Matching the requested version does not prove correspondence or
fitness for redistribution.

## Evidence retention and validation receipt

Local external evidence root: `D:\GitHub\.affect-checks\rr04-source-provenance-20260912`.
`archives/` contains exactly the six downloaded archive bodies above;
`license-evidence/` contains their read-only root license-text copies.
`cerbero-files/` contains selected raw files at the exact commit. These local
artifacts are outside Git and are not yet a published source offer or a durable
release archive. Public URLs and hashes above support independent reacquisition.

| Retained receipt | SHA-256 |
| --- | --- |
| `source-metadata.json` | `3556ae7c161366d58ce56572efc2f5664653f587a4c8e0688643d8b0e3d03b8f` |
| `retained-sources.json` | `dfd5722e066ef859d78e6ed9ad79fb38729c853f44166db2134b000e4df76e9c` |
| `upstream-metadata.json` | `d5a77f8c1479c6efe143e4be5f569ed83ea1ae1d4cfca6706c3d5287a3d062ca` |
| `cerbero-resolution.json` | `e5eb2c0d49df2df6cabb261f9709abba13ab4bb242dfe83b1e6b547207c637b7` |
| `cerbero-tag-object.json` | `c794cb1016c05e0ffc007e68c9773c463b583ba7a0f211aa71dc42b694ce8314` |
| `cerbero-tree.json` | `e2d98d52787de4507250ba9b389851ecda0a1ddd6e616c8e73b0b70562565316` |
| `cerbero-file-receipt.json` | `18a37eb77c9b44b06a90d311aaf29e61d65e9ab530084c17d3f3cb34f3717f80` |
| `cerbero-extra-receipt.json` | `8887a449ab440ca044d6375dc581baf34871766b1b785f82f8699459f2d63b31` |
| `runtime-inventory.json` | `9650d73120f09c2dff47f6d22c5646f9fdb05a2e01d6d4949bd429c7356cbb24` |
| `root-source-review.json` | `31ef4f835349bac1cf66fc2661c60f6ad10496878f54388783c0f9d798d89d4c` |

The coordinator independently checked all six archives and six license files;
`root-source-review.json` records that successful check and explicitly leaves
transitive closure and distribution approval false.

Validation for this document: all six retained archive bodies rehashed against
the pin, metadata and retained-source receipts; license member hashes and ten
source-target member hashes checked; numeric totals and cited recipe declarations
checked against retained evidence; repository diff whitespace/scope checked.
No build, application test, installed playback test, source code execution,
installer execution, runtime mutation, or approval flag change was performed.
