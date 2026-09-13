//! Closed broker IPC and retained native outcomes. No filesystem authority here.
use super::wire::{
    is_uuid, Consequence, PlannerAction, PlannerCommand, PlannerResponse, MAX_FRAME_BYTES,
};
use crate::research_contracts::canonical_json;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_planner_cli_io::CliIoRequestBinding;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use uuid::Uuid;

pub(super) const COMPACT_LIMIT: usize = 64 * 1024;
const RETAINED_LIMIT: usize = 8 * 1024 * 1024;
const BULK_LIMIT: usize = 2 * MAX_FRAME_BYTES;
const MAX_RECORDS: usize = 1024;

pub(super) fn failure(code: &str, message: &str) -> CommandError {
    CommandError::new(code, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (NativeLedger, PlannerCommand, NativeRequest) {
        let original: PlannerCommand = serde_json::from_value(json!({"schema":"affect-research-planner-command","version":1,
            "sessionId":Uuid::new_v4(),"requestId":Uuid::new_v4(),"expectedRevision":0,
            "action":{"kind":"perform","operation":"saveRecipe","arguments":{"directory":"D:/synthetic"}}})).unwrap();
        let grant = Uuid::new_v4();
        let mut ledger = NativeLedger::default();
        ledger.admit(&original).unwrap();
        let forwarded = Consequence::parse("saveRecipe", &json!({"directory":"D:/synthetic"}))
            .unwrap()
            .forward(&original, Some(grant))
            .unwrap();
        ledger.remember_forward(forwarded, Some(grant)).unwrap();
        let request = NativeRequest {
            context: NativeContext {
                session_id: original.session_id.clone(),
                request_id: original.request_id.clone(),
                expected_revision: 0,
            },
            action: NativeAction::WriteRecipe {
                grant_id: grant,
                source_text: "{}".into(),
            },
        };
        (ledger, original, request)
    }
    fn reserve(ledger: &mut NativeLedger, request: &NativeRequest) {
        assert!(matches!(
            ledger.reserve(request).unwrap(),
            CallAdmission::Execute(_)
        ));
    }
    fn code<T>(result: ResearchResult<T>) -> String {
        result.err().expect("expected rejection").code
    }

    #[test]
    fn capacity_is_reserved_before_effect_and_retention_never_evicts_prior_identity() {
        for bulk_full in [false, true] {
            let (mut ledger, original, request) = fixture();
            if bulk_full {
                ledger.bulk_reserved = BULK_LIMIT;
            } else {
                ledger.retained_bytes = RETAINED_LIMIT;
            }
            assert_eq!(code(ledger.reserve(&request)), "session_capacity");
            assert!(!ledger.has_call(&original.request_id));
            assert!(ledger.lease.is_none());
            assert!(ledger.records.contains_key(&original.request_id));
        }
    }
    #[test]
    fn in_flight_native_call_cannot_complete_or_repeat_and_pending_bulk_is_released() {
        let (mut ledger, original, request) = fixture();
        reserve(&mut ledger, &request);
        assert_eq!(
            code(ledger.complete(&original.request_id)),
            "native_in_flight"
        );
        assert_eq!(code(ledger.reserve(&request)), "native_in_flight");
        assert_eq!(ledger.bulk_reserved, MAX_FRAME_BYTES);
        let mut result = NativeResult::new(&request);
        result.payload = json!({"sourceText":"synthetic"});
        ledger.finish(&original.request_id, result, false).unwrap();
        assert!(ledger.bulk_reserved < MAX_FRAME_BYTES);
        ledger.complete(&original.request_id).unwrap();
        assert_eq!(ledger.bulk_reserved, 0);
        assert!(ledger.lease.is_none());
    }
    #[test]
    fn oversized_encoded_response_retains_acknowledged_compact_effect() {
        let (mut ledger, original, request) = fixture();
        reserve(&mut ledger, &request);
        let mut result = NativeResult::new(&request);
        result.effect = json!({"outcome":"acknowledged","receipt":{"basename":"synthetic.json"}});
        result.payload = json!({"sourceText":"\n".repeat(MAX_FRAME_BYTES / 2)});
        let result = ledger.finish(&original.request_id, result, false).unwrap();
        assert!(result.payload.is_null());
        assert_eq!(result.error.unwrap().code, "native_result_limit");
        assert_eq!(result.effect["receipt"]["basename"], "synthetic.json");
        ledger.complete(&original.request_id).unwrap();
    }
    #[test]
    fn shutdown_retains_unknown_then_late_known_outcome_without_pending_bulk() {
        let (mut ledger, original, request) = fixture();
        reserve(&mut ledger, &request);
        ledger.close();
        assert_eq!(
            ledger.records[&original.request_id]
                .call
                .as_ref()
                .unwrap()
                .result
                .effect["outcome"],
            "unknown"
        );
        let mut result = NativeResult::new(&request);
        result.effect = json!({"outcome":"acknowledged","receipt":{"basename":"synthetic.json"}});
        result.payload = json!({"large":"payload"});
        result.superseded = Some(failure("session_closed", "Closed."));
        ledger.finish(&original.request_id, result, true).unwrap();
        assert_eq!(ledger.bulk_reserved, 0);
        let CallAdmission::Retained(receipt) = ledger.reserve(&request).unwrap() else {
            panic!("redispatched")
        };
        assert_eq!(receipt.effect["outcome"], "acknowledged");
        assert!(receipt.payload.is_null());
        assert!(receipt.superseded.is_some());
    }
    #[test]
    fn changed_native_payload_cannot_reuse_a_completed_original() {
        let (mut ledger, original, request) = fixture();
        reserve(&mut ledger, &request);
        ledger
            .finish(&original.request_id, NativeResult::new(&request), false)
            .unwrap();
        let mut changed = request;
        if let NativeAction::WriteRecipe { source_text, .. } = &mut changed.action {
            *source_text = "different".into();
        }
        assert_eq!(code(ledger.reserve(&changed)), "request_id_reused");
    }
}
pub(super) fn fingerprint<T: Serialize>(value: &T) -> ResearchResult<[u8; 32]> {
    Ok(Sha256::digest(canonical_json(value, &[])?).into())
}
pub(super) fn encoded_size<T: Serialize>(value: &T) -> ResearchResult<usize> {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .map_err(CommandError::io)
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NativeContext {
    pub session_id: String,
    pub request_id: String,
    pub expected_revision: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RevisionNotice {
    pub session_id: String,
    pub revision: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NativeRequest {
    pub context: NativeContext,
    pub action: NativeAction,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum NativeAction {
    SelectWorkspace {
        #[serde(rename = "grantId")]
        grant_id: Uuid,
    },
    ImportVideos {
        #[serde(rename = "grantId")]
        grant_id: Uuid,
        #[serde(rename = "workspaceId")]
        workspace_id: String,
    },
    ImportVideoFolder {
        #[serde(rename = "grantId")]
        grant_id: Uuid,
        #[serde(rename = "workspaceId")]
        workspace_id: String,
    },
    RescanVideoLibrary {
        #[serde(rename = "workspaceId")]
        workspace_id: String,
    },
    ReadQuestionnaire {
        #[serde(rename = "grantId")]
        grant_id: Uuid,
    },
    StoreQuestionnaire {
        #[serde(rename = "workspaceId")]
        workspace_id: String,
        #[serde(rename = "questionnaireId")]
        questionnaire_id: String,
        #[serde(rename = "familyId")]
        family_id: String,
        #[serde(rename = "languageTag")]
        language_tag: String,
        format: String,
        #[serde(rename = "sourceSha256")]
        source_sha256: String,
        #[serde(rename = "bytesHex")]
        bytes_hex: String,
    },
    WriteRecipe {
        #[serde(rename = "grantId")]
        grant_id: Uuid,
        #[serde(rename = "sourceText")]
        source_text: String,
    },
    ReadRecipe {
        #[serde(rename = "grantId")]
        grant_id: Uuid,
    },
}
impl NativeAction {
    pub(super) fn operation(&self) -> &'static str {
        match self {
            Self::SelectWorkspace { .. } => "selectWorkspace",
            Self::ImportVideos { .. } => "importVideos",
            Self::ImportVideoFolder { .. } => "importVideoFolder",
            Self::RescanVideoLibrary { .. } => "rescanVideoLibrary",
            Self::ReadQuestionnaire { .. } => "importQuestionnaire",
            Self::StoreQuestionnaire { .. } => "saveQuestionnaire",
            Self::WriteRecipe { .. } => "saveRecipe",
            Self::ReadRecipe { .. } => "openRecipe",
        }
    }
    pub(super) fn grant(&self) -> Option<Uuid> {
        match self {
            Self::SelectWorkspace { grant_id }
            | Self::ImportVideos { grant_id, .. }
            | Self::ImportVideoFolder { grant_id, .. }
            | Self::ReadQuestionnaire { grant_id }
            | Self::WriteRecipe { grant_id, .. }
            | Self::ReadRecipe { grant_id } => Some(*grant_id),
            _ => None,
        }
    }
    pub(super) fn is_read(&self) -> bool {
        matches!(
            self,
            Self::ReadQuestionnaire { .. } | Self::ReadRecipe { .. }
        )
    }
}
impl NativeRequest {
    pub(super) fn validate(&self) -> ResearchResult<()> {
        if !is_uuid(&self.context.session_id)
            || !is_uuid(&self.context.request_id)
            || self.context.expected_revision > 9_007_199_254_740_991
            || encoded_size(&json!({"request":self}))? + 1 > MAX_FRAME_BYTES
        {
            return Err(failure(
                "invalid_native_request",
                "Native command identity or encoded size is invalid.",
            ));
        }
        if self.action.grant().is_some_and(|grant| grant.is_nil()) {
            return Err(failure(
                "invalid_native_request",
                "A selection grant is required.",
            ));
        }
        let text = |value: &str, max: usize| {
            !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
        };
        let valid = match &self.action {
            NativeAction::ImportVideos { workspace_id, .. }
            | NativeAction::ImportVideoFolder { workspace_id, .. }
            | NativeAction::RescanVideoLibrary { workspace_id } => text(workspace_id, 128),
            NativeAction::StoreQuestionnaire {
                workspace_id,
                questionnaire_id,
                family_id,
                language_tag,
                format,
                source_sha256,
                bytes_hex,
            } => {
                text(workspace_id, 128)
                    && text(questionnaire_id, 128)
                    && text(family_id, 128)
                    && text(language_tag, 80)
                    && matches!(format.as_str(), "csv" | "txt" | "json")
                    && source_sha256.len() == 64
                    && source_sha256
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                    && !bytes_hex.is_empty()
                    && bytes_hex.len() <= 10 * 1024 * 1024
                    && bytes_hex.len() % 2 == 0
                    && bytes_hex
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            }
            NativeAction::WriteRecipe { source_text, .. } => {
                !source_text.is_empty() && source_text.len() <= MAX_FRAME_BYTES
            }
            _ => true,
        };
        if !valid {
            return Err(failure(
                "invalid_native_request",
                "Native operation arguments are invalid or exceed their bounds.",
            ));
        }
        Ok(())
    }
}

pub(super) fn source_bytes(hex: &str, expected: &str) -> ResearchResult<Vec<u8>> {
    let nibble = |b: u8| {
        if b.is_ascii_digit() {
            b - b'0'
        } else {
            b - b'a' + 10
        }
    };
    let bytes: Vec<u8> = hex
        .as_bytes()
        .chunks_exact(2)
        .map(|p| (nibble(p[0]) << 4) | nibble(p[1]))
        .collect();
    if format!("{:x}", Sha256::digest(&bytes)) != expected {
        return Err(failure(
            "source_hash_mismatch",
            "Questionnaire bytes do not match the declared source identity.",
        ));
    }
    Ok(bytes)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeResult {
    pub schema: &'static str,
    pub version: u8,
    pub operation: String,
    pub effect: Value,
    pub payload: Value,
    pub error: Option<CommandError>,
    pub superseded: Option<CommandError>,
}
impl NativeResult {
    pub(super) fn new(request: &NativeRequest) -> Self {
        Self {
            schema: "affect-research-planner-native-result",
            version: 1,
            operation: request.action.operation().into(),
            effect: json!({"operation":request.action.operation(),"requestId":request.context.request_id,
                "stage":"dispatching","outcome":"unknown","possiblyChanged":!request.action.is_read()}),
            payload: Value::Null,
            error: None,
            superseded: None,
        }
    }
    fn compact(&self) -> Self {
        Self {
            payload: Value::Null,
            ..self.clone()
        }
    }
}

struct NativeCall {
    fingerprint: [u8; 32],
    result: NativeResult,
    running: bool,
    compact_bytes: usize,
    bulk: Option<Value>,
    bulk_bytes: usize,
}
struct Record {
    fingerprint: [u8; 32],
    expected_revision: Option<u64>,
    operation: Option<String>,
    questionnaire_id: Option<String>,
    forwarded: Option<PlannerCommand>,
    grant: Option<Uuid>,
    canceled: bool,
    completed: bool,
    bytes: usize,
    call: Option<NativeCall>,
    denied: Option<PlannerResponse>,
}
#[derive(Default)]
pub(super) struct NativeLedger {
    records: HashMap<String, Record>,
    retained_bytes: usize,
    bulk_reserved: usize,
    lease: Option<String>,
}
pub(super) enum CallAdmission {
    Execute(CliIoRequestBinding),
    Retained(NativeResult),
}

impl NativeLedger {
    pub(super) fn has_call(&self, id: &str) -> bool {
        self.records
            .get(id)
            .is_some_and(|record| record.call.is_some())
    }
    pub(super) fn admit(&mut self, request: &PlannerCommand) -> ResearchResult<()> {
        let hash = fingerprint(request)?;
        if let Some(prior) = self.records.get(&request.request_id) {
            if prior.fingerprint != hash {
                return Err(failure(
                    "request_id_reused",
                    "Request identity was reused with different original content.",
                ));
            }
            return Ok(());
        }
        if !matches!(
            request.action,
            PlannerAction::Set { .. } | PlannerAction::Apply { .. } | PlannerAction::Perform { .. }
        ) {
            return Ok(());
        }
        let (operation, questionnaire_id) = if let PlannerAction::Perform {
            operation,
            arguments,
        } = &request.action
        {
            let parsed = Consequence::parse(operation, arguments)?;
            (
                Some(parsed.name().into()),
                match parsed {
                    Consequence::SaveQuestionnaire { questionnaire_id } => Some(questionnaire_id),
                    _ => None,
                },
            )
        } else {
            (None, None)
        };
        let bytes = 256 + questionnaire_id.as_ref().map_or(0, String::len);
        if self.records.len() >= MAX_RECORDS || self.retained_bytes + bytes > RETAINED_LIMIT {
            return Err(failure(
                "session_capacity",
                "Original request retention is full. Start a new session.",
            ));
        }
        self.retained_bytes += bytes;
        self.records.insert(
            request.request_id.clone(),
            Record {
                fingerprint: hash,
                expected_revision: request.expected_revision,
                operation,
                questionnaire_id,
                forwarded: None,
                grant: None,
                canceled: false,
                completed: false,
                bytes,
                call: None,
                denied: None,
            },
        );
        Ok(())
    }
    pub(super) fn binding(&self, request: &PlannerCommand) -> ResearchResult<CliIoRequestBinding> {
        let record = self
            .records
            .get(&request.request_id)
            .ok_or_else(|| failure("unknown_request", "Original command is unavailable."))?;
        if record.fingerprint != fingerprint(request)? {
            return Err(failure("request_id_reused", "Original request changed."));
        }
        if record.canceled {
            return Err(failure("canceled", "The native operation was canceled."));
        }
        Ok(CliIoRequestBinding {
            session_id: Uuid::parse_str(&request.session_id).map_err(CommandError::io)?,
            request_id: Uuid::parse_str(&request.request_id).map_err(CommandError::io)?,
            request_sha256: record.fingerprint,
        })
    }
    pub(super) fn forwarded(&self, id: &str) -> Option<PlannerCommand> {
        self.records
            .get(id)
            .and_then(|record| record.forwarded.clone())
    }
    pub(super) fn denied(&self, id: &str) -> Option<PlannerResponse> {
        self.records
            .get(id)
            .and_then(|record| record.denied.clone())
    }
    pub(super) fn retain_denial(&mut self, response: &PlannerResponse) -> ResearchResult<()> {
        if let Some(record) = self.records.get_mut(&response.request_id) {
            if record.denied.is_none() {
                let bytes = encoded_size(response)?;
                if (bytes > COMPACT_LIMIT) || self.retained_bytes + bytes > RETAINED_LIMIT {
                    return Err(failure("session_capacity", "Rejection retention is full."));
                }
                self.retained_bytes += bytes;
                record.bytes += bytes;
                record.denied = Some(response.clone());
            }
        }
        Ok(())
    }
    pub(super) fn remember_forward(
        &mut self,
        request: PlannerCommand,
        grant: Option<Uuid>,
    ) -> ResearchResult<()> {
        let bytes = encoded_size(&request)?;
        let record = self
            .records
            .get_mut(&request.request_id)
            .ok_or_else(|| failure("unknown_request", "Original command is unavailable."))?;
        if self.retained_bytes + bytes > RETAINED_LIMIT {
            return Err(failure(
                "session_capacity",
                "Forwarded command retention is full.",
            ));
        }
        if record.forwarded.is_none() {
            record.bytes += bytes;
            self.retained_bytes += bytes;
            record.forwarded = Some(request);
            record.grant = grant;
        }
        Ok(())
    }
    pub(super) fn cancel(&mut self, id: &str) {
        if let Some(record) = self.records.get_mut(id) {
            record.canceled = true;
        }
    }
    pub(super) fn check(&self, context: &NativeContext) -> ResearchResult<()> {
        let record = self.records.get(&context.request_id).ok_or_else(|| {
            failure(
                "unknown_request",
                "No original native command is available.",
            )
        })?;
        if record.canceled {
            return Err(failure("canceled", "The native operation was canceled."));
        }
        if record.expected_revision != Some(context.expected_revision) || record.completed {
            return Err(failure(
                "stale_revision",
                "The native command is no longer active at its original revision.",
            ));
        }
        Ok(())
    }
    pub(super) fn reserve(&mut self, request: &NativeRequest) -> ResearchResult<CallAdmission> {
        let hash = fingerprint(request)?;
        let record = self
            .records
            .get_mut(&request.context.request_id)
            .ok_or_else(|| failure("unknown_request", "No original command is available."))?;
        if record.operation.as_deref() != Some(request.action.operation())
            || record.expected_revision != Some(request.context.expected_revision)
            || record.grant != request.action.grant()
            || record.forwarded.is_none()
        {
            return Err(failure(
                "operation_mismatch",
                "Native operation or grant differs from the original command.",
            ));
        }
        if let NativeAction::StoreQuestionnaire {
            questionnaire_id, ..
        } = &request.action
        {
            if record.questionnaire_id.as_ref() != Some(questionnaire_id) {
                return Err(failure(
                    "operation_mismatch",
                    "Questionnaire identity differs from the original command.",
                ));
            }
        }
        if let Some(call) = &record.call {
            if call.fingerprint != hash {
                return Err(failure(
                    "request_id_reused",
                    "Native request identity was reused with different payload.",
                ));
            }
            if call.running {
                return Err(failure(
                    "native_in_flight",
                    "The native effect is still in flight; do not repeat it.",
                ));
            }
            let mut result = call.result.clone();
            if let Some(payload) = &call.bulk {
                result.payload = payload.clone();
            } else {
                result.error = Some(failure(
                    "effect_already_completed",
                    "The original effect has completed; reconcile its retained command receipt.",
                ));
            }
            return Ok(CallAdmission::Retained(result));
        }
        if record.canceled || record.completed {
            return Err(failure(
                "canceled",
                "The original native operation is no longer available.",
            ));
        }
        if self
            .lease
            .as_ref()
            .is_some_and(|id| id != &request.context.request_id)
        {
            return Err(failure(
                "native_busy",
                "Another command owns native effects until its publication completes.",
            ));
        }
        if self.retained_bytes + COMPACT_LIMIT > RETAINED_LIMIT
            || self.bulk_reserved + MAX_FRAME_BYTES > BULK_LIMIT
        {
            return Err(failure(
                "session_capacity",
                "Native result retention is full before dispatch.",
            ));
        }
        self.retained_bytes += COMPACT_LIMIT;
        self.bulk_reserved += MAX_FRAME_BYTES;
        self.lease = Some(request.context.request_id.clone());
        record.call = Some(NativeCall {
            fingerprint: hash,
            result: NativeResult::new(request),
            running: true,
            compact_bytes: COMPACT_LIMIT,
            bulk: None,
            bulk_bytes: MAX_FRAME_BYTES,
        });
        Ok(CallAdmission::Execute(CliIoRequestBinding {
            session_id: Uuid::parse_str(&request.context.session_id).map_err(CommandError::io)?,
            request_id: Uuid::parse_str(&request.context.request_id).map_err(CommandError::io)?,
            request_sha256: record.fingerprint,
        }))
    }
    pub(super) fn finish(
        &mut self,
        id: &str,
        mut result: NativeResult,
        closed: bool,
    ) -> ResearchResult<NativeResult> {
        let call = self
            .records
            .get_mut(id)
            .and_then(|r| r.call.as_mut())
            .ok_or_else(|| {
                failure(
                    "unknown_effect",
                    "Native effect reservation is unavailable.",
                )
            })?;
        if !call.running {
            return Err(failure(
                "effect_already_completed",
                "Native effect completion was already retained.",
            ));
        }
        if encoded_size(&result)? > MAX_FRAME_BYTES {
            result.payload = Value::Null;
            result.error = Some(failure("native_result_limit", "Native effect finished, but its encoded response exceeds the transport bound. Inspect the retained effect."));
        }
        let compact = result.compact();
        let bytes = encoded_size(&compact)?;
        if bytes > COMPACT_LIMIT {
            return Err(failure("native_result_limit", "Native effect acknowledgement exceeds compact retention; its prior unknown outcome remains retained."));
        }
        self.retained_bytes = self.retained_bytes - call.compact_bytes + bytes;
        self.bulk_reserved -= call.bulk_bytes;
        call.compact_bytes = bytes;
        call.running = false;
        call.result = compact;
        call.bulk_bytes = if closed {
            0
        } else {
            encoded_size(&result.payload)?
        };
        call.bulk = if closed {
            None
        } else {
            Some(result.payload.clone())
        };
        self.bulk_reserved += call.bulk_bytes;
        Ok(result)
    }
    pub(super) fn complete(&mut self, id: &str) -> ResearchResult<()> {
        if let Some(record) = self.records.get_mut(id) {
            if let Some(call) = &mut record.call {
                if call.running {
                    return Err(failure(
                        "native_in_flight",
                        "Cannot complete a command while its native outcome is unknown.",
                    ));
                }
                self.bulk_reserved -= call.bulk_bytes;
                call.bulk_bytes = 0;
                call.bulk = None;
            }
            record.completed = true;
        }
        if self.lease.as_deref() == Some(id) {
            self.lease = None;
        }
        Ok(())
    }
    pub(super) fn close(&mut self) {
        for record in self.records.values_mut() {
            record.canceled = true;
            if let Some(call) = &mut record.call {
                if !call.running {
                    self.bulk_reserved -= call.bulk_bytes;
                    call.bulk_bytes = 0;
                    call.bulk = None;
                }
            }
        }
        // Compact known or still-unknown outcomes survive shutdown in this
        // broker instance. This is not a cross-process recovery journal.
    }
}
