//! Bounded master-only information framing. The receiver needs no recipe sidecar.
use crate::research_contracts::{canonical_json, validate_sha256};
use crate::research_error::{CommandError, ResearchResult};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};

pub(crate) const MAX_TRANSFER_BYTES: usize = 64 * 1024 * 1024;
pub(crate) const CHUNK_BYTES: usize = 64 * 1024;
pub(crate) const MAX_FRAME_BYTES: usize = 128 * 1024;
const MAX_FRAMES: u64 = 1_000_000;
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ContentKind {
    Startup,
    Observation,
    Responses,
    Outcome,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InformationFrame {
    schema: String,
    version: u32,
    run_id: String,
    attempt_id: String,
    recipe_source_byte_sha256: String,
    sequence: u64,
    payload: Payload,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Payload {
    #[serde(rename_all = "camelCase")]
    Header {
        transfer_id: String,
        content_kind: ContentKind,
        byte_length: usize,
        sha256: String,
        chunk_count: usize,
    },
    #[serde(rename_all = "camelCase")]
    Chunk {
        transfer_id: String,
        index: usize,
        data: String,
    },
    #[serde(rename_all = "camelCase")]
    Commit { transfer_id: String, sha256: String },
}
pub(crate) struct PreparedTransfer {
    bytes: Vec<u8>,
    sha256: String,
}
impl PreparedTransfer {
    pub(crate) fn new(value: &impl Serialize) -> ResearchResult<Self> {
        let bytes = canonical_json(value, &[])?;
        if bytes.is_empty() || bytes.len() > MAX_TRANSFER_BYTES {
            return Err(invalid("Information transfer exceeds its 64 MiB bound."));
        }
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        Ok(Self { bytes, sha256 })
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InformationReceipt {
    pub first_lsl_time_seconds: f64,
    pub commit_lsl_time_seconds: f64,
    pub first_sequence: u64,
    pub last_sequence: u64,
    pub transfer_sha256: String,
}
pub(crate) struct InformationWriter {
    run_id: String,
    attempt_id: String,
    source_hash: String,
    sequence: u64,
    started: bool,
    failed: bool,
    ended: bool,
    created: Instant,
    last_lsl: Option<f64>,
}
impl InformationWriter {
    pub(crate) fn new(run_id: &str, attempt_id: &str, source_hash: &str) -> ResearchResult<Self> {
        if !super::markers::code(run_id) || !super::markers::code(attempt_id) {
            return Err(invalid(
                "Information context requires bounded run/attempt codes.",
            ));
        }
        validate_sha256(source_hash, "information recipe identity")?;
        Ok(Self {
            run_id: run_id.into(),
            attempt_id: attempt_id.into(),
            source_hash: source_hash.into(),
            sequence: 0,
            started: false,
            failed: false,
            ended: false,
            created: Instant::now(),
            last_lsl: None,
        })
    }
    pub(crate) fn send(
        &mut self,
        kind: ContentKind,
        transfer: PreparedTransfer,
        mut publish: impl FnMut(&str) -> ResearchResult<f64>,
    ) -> ResearchResult<InformationReceipt> {
        if self.failed || self.ended || self.started == (kind == ContentKind::Startup) {
            self.failed = true;
            return Err(invalid("Information startup must commit exactly once; no records follow failure or outcome."));
        }
        let deadline = if kind == ContentKind::Startup {
            self.created + TRANSFER_TIMEOUT
        } else {
            Instant::now() + TRANSFER_TIMEOUT
        };
        let result = self.send_inner(kind, transfer, deadline, &mut publish);
        if result.is_err() {
            self.failed = true;
        } else {
            self.started = true;
            self.ended = kind == ContentKind::Outcome;
        }
        result
    }
    pub(crate) fn require_ready(&self) -> ResearchResult<()> {
        if !self.started || self.failed || self.ended {
            Err(invalid(
                "Acquisition requires committed startup and an active information writer.",
            ))
        } else {
            Ok(())
        }
    }
    fn send_inner(
        &mut self,
        kind: ContentKind,
        transfer: PreparedTransfer,
        deadline: Instant,
        publish: &mut impl FnMut(&str) -> ResearchResult<f64>,
    ) -> ResearchResult<InformationReceipt> {
        let id = format!("transfer-{}", uuid::Uuid::new_v4());
        let first_sequence = self.sequence + 1;
        let first = self.frame(
            Payload::Header {
                transfer_id: id.clone(),
                content_kind: kind,
                byte_length: transfer.bytes.len(),
                sha256: transfer.sha256.clone(),
                chunk_count: transfer.bytes.len().div_ceil(CHUNK_BYTES),
            },
            deadline,
            publish,
        )?;
        for (index, bytes) in transfer.bytes.chunks(CHUNK_BYTES).enumerate() {
            self.frame(
                Payload::Chunk {
                    transfer_id: id.clone(),
                    index,
                    data: STANDARD.encode(bytes),
                },
                deadline,
                publish,
            )?;
        }
        let commit = self.frame(
            Payload::Commit {
                transfer_id: id,
                sha256: transfer.sha256.clone(),
            },
            deadline,
            publish,
        )?;
        Ok(InformationReceipt {
            first_lsl_time_seconds: first,
            commit_lsl_time_seconds: commit,
            first_sequence,
            last_sequence: self.sequence,
            transfer_sha256: transfer.sha256,
        })
    }
    fn frame(
        &mut self,
        payload: Payload,
        deadline: Instant,
        publish: &mut impl FnMut(&str) -> ResearchResult<f64>,
    ) -> ResearchResult<f64> {
        if Instant::now() > deadline {
            return Err(invalid("Information transfer timed out before commit."));
        }
        self.sequence = self
            .sequence
            .checked_add(1)
            .filter(|n| *n <= MAX_FRAMES)
            .ok_or_else(|| invalid("Information frame sequence exceeds its bound."))?;
        let frame = InformationFrame {
            schema: "affect-runner-information".into(),
            version: 1,
            run_id: self.run_id.clone(),
            attempt_id: self.attempt_id.clone(),
            recipe_source_byte_sha256: self.source_hash.clone(),
            sequence: self.sequence,
            payload,
        };
        let bytes = canonical_json(&frame, &[])?;
        if bytes.len() > MAX_FRAME_BYTES {
            return Err(invalid("Information wire frame exceeds 128 KiB."));
        }
        let text =
            std::str::from_utf8(&bytes).map_err(|_| invalid("Information frame is not UTF-8."))?;
        let timestamp = publish(text)?;
        if !timestamp.is_finite() || self.last_lsl.is_some_and(|last| timestamp < last) {
            return Err(invalid("Information LSL publication clock reversed."));
        }
        if Instant::now() > deadline {
            return Err(invalid(
                "Information transfer exceeded its publication deadline.",
            ));
        }
        self.last_lsl = Some(timestamp);
        Ok(timestamp)
    }
}
fn invalid(message: &str) -> CommandError {
    // Publication/assembly failures after accepting a form must terminate the
    // worker, unlike a rejected participant answer which may be corrected.
    CommandError::new("runner_information_failed", message)
}

pub(crate) fn startup_bundle(
    prepared: &super::PreparedMaster,
    markers: &super::markers::MasterMarkers,
    settings: &crate::research_contracts::ResearchLslSettingsV1,
    participant: serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({"schema":"affect-runner-startup","version":1,"recipeSourceText":prepared.loaded.canonical_source_text,"recipeSourceByteSha256":prepared.plan.recipe_source_byte_sha256,"planIdentitySha256":prepared.plan.plan_identity_sha256,"participantId":prepared.plan.participant_id,"selector":prepared.plan.selector,"markerProfile":markers.profile_message,"effectiveLsl":settings,"legacyCodedParticipant":participant,"build":{"commit":env!("AFFECT_TRACKER_BUILD_COMMIT"),"appVersion":env!("CARGO_PKG_VERSION")}})
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn bounded_multi_chunk_transfer_is_exact_and_context_sequenced() {
        let value = json!({"text":"ü test ".repeat(20000)});
        let expected = canonical_json(&value, &[]).unwrap();
        let mut writer =
            InformationWriter::new("run-test", "attempt-test", &"a".repeat(64)).unwrap();
        let mut rows = Vec::new();
        let receipt = writer
            .send(
                ContentKind::Startup,
                PreparedTransfer::new(&value).unwrap(),
                |text| {
                    rows.push(text.to_owned());
                    Ok(rows.len() as f64)
                },
            )
            .unwrap();
        assert!(rows.len() > 3);
        assert_eq!(receipt.first_sequence, 1);
        assert_eq!(receipt.last_sequence, rows.len() as u64);
        let frames = rows
            .iter()
            .map(|text| serde_json::from_str::<InformationFrame>(text).unwrap())
            .collect::<Vec<_>>();
        let mut decoded = Vec::new();
        for (i, frame) in frames.iter().enumerate() {
            assert_eq!(frame.sequence, i as u64 + 1);
            assert_eq!(frame.run_id, "run-test");
            assert!(rows[i].len() <= MAX_FRAME_BYTES);
            if let Payload::Chunk { index, data, .. } = &frame.payload {
                assert_eq!(*index, i - 1);
                decoded.extend(STANDARD.decode(data).unwrap());
            }
        }
        assert_eq!(decoded, expected);
        assert_eq!(
            receipt.transfer_sha256,
            format!("{:x}", Sha256::digest(&decoded))
        );
        assert!(writer
            .send(
                ContentKind::Startup,
                PreparedTransfer::new(&json!({})).unwrap(),
                |_| Ok(99.)
            )
            .is_err());
    }
    #[test]
    fn failure_timeout_and_sequence_bounds_never_produce_successful_commit() {
        let make = || InformationWriter::new("run-test", "attempt-test", &"b".repeat(64)).unwrap();
        let data = || PreparedTransfer::new(&json!({"test":true})).unwrap();
        let mut writer = make();
        let mut count = 0;
        assert!(writer
            .send(ContentKind::Startup, data(), |_| {
                count += 1;
                if count == 2 {
                    Err(invalid("synthetic failure"))
                } else {
                    Ok(1.)
                }
            })
            .is_err());
        assert_eq!(count, 2);
        assert!(writer
            .send(ContentKind::Startup, data(), |_| Ok(2.))
            .is_err());
        let mut writer = make();
        writer.created = Instant::now() - Duration::from_secs(31);
        assert!(writer
            .send(ContentKind::Startup, data(), |_| panic!(
                "expired transfer published"
            ))
            .is_err());
        let mut writer = make();
        writer.sequence = MAX_FRAMES;
        assert!(writer
            .send(ContentKind::Startup, data(), |_| panic!(
                "exhausted sequence published"
            ))
            .is_err());
        let mut writer = make();
        assert!(writer
            .send(ContentKind::Observation, data(), |_| panic!(
                "record preceded startup"
            ))
            .is_err());
        assert!(writer.require_ready().is_err());
        assert!(writer
            .send(ContentKind::Startup, data(), |_| panic!(
                "failed writer retried"
            ))
            .is_err());
        let mut writer = make();
        let mut time = 2.;
        assert!(writer
            .send(ContentKind::Startup, data(), |_| {
                time -= 0.1;
                Ok(time)
            })
            .is_err());
        assert!(writer.require_ready().is_err());
        let mut writer = make();
        writer
            .send(ContentKind::Startup, data(), |_| Ok(1.))
            .unwrap();
        assert!(writer.require_ready().is_ok());
        writer
            .send(ContentKind::Outcome, data(), |_| Ok(2.))
            .unwrap();
        assert!(writer.require_ready().is_err());
        assert!(writer
            .send(ContentKind::Observation, data(), |_| panic!(
                "published after outcome"
            ))
            .is_err());
    }
    #[test]
    fn oversize_transfer_rejects_before_publication() {
        assert!(PreparedTransfer::new(&"x".repeat(MAX_TRANSFER_BYTES)).is_err());
    }
}
