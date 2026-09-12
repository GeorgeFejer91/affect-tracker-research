use crate::research_error::{CommandError, ResearchResult};
use serde::de::{MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};
use std::fmt;
use uuid::Uuid;

pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
const MAX_SAFE_REVISION: u64 = 9_007_199_254_740_991;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannerCommand {
    pub schema: String,
    pub version: u8,
    pub session_id: String,
    pub request_id: String,
    pub expected_revision: Option<u64>,
    pub action: PlannerAction,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum PlannerAction {
    Catalogue,
    Snapshot,
    Get {
        field: String,
    },
    Validate {
        owner: Option<String>,
    },
    Set {
        field: String,
        value: Value,
    },
    Apply {
        edits: Vec<PlannerEdit>,
    },
    Cancel {
        #[serde(rename = "requestId")]
        request_id: String,
    },
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum PlannerEdit {
    Set {
        field: String,
        value: Value,
    },
    Operation {
        owner: String,
        operation: String,
        arguments: Value,
    },
}

pub fn is_uuid(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| {
        id.to_string() == value
            && matches!(value.as_bytes()[14], b'1'..=b'8')
            && matches!(value.as_bytes()[19], b'8' | b'9' | b'a' | b'b')
    })
}

fn owner(value: &str) -> bool {
    matches!(value, "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7")
}

fn field(value: &str) -> bool {
    value.len() >= 4
        && value.len() <= 163
        && value.is_ascii()
        && owner(&value[..2])
        && value.as_bytes()[2] == b'.'
        && value.as_bytes()[3].is_ascii_alphabetic()
        && value[3..]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
}

fn check_json(value: &Value, depth: usize) -> bool {
    if depth > 64 {
        return false;
    }
    match value {
        Value::Array(values) => values.iter().all(|value| check_json(value, depth + 1)),
        Value::Object(values) => values.iter().all(|(key, value)| {
            !matches!(key.as_str(), "__proto__" | "prototype" | "constructor")
                && check_json(value, depth + 1)
        }),
        _ => true,
    }
}

fn edit_valid(edit: &PlannerEdit) -> bool {
    match edit {
        PlannerEdit::Set { field: name, .. } => field(name),
        PlannerEdit::Operation {
            owner: id,
            operation,
            ..
        } => {
            owner(id)
                && !operation.is_empty()
                && operation.len() <= 80
                && operation.as_bytes()[0].is_ascii_lowercase()
                && operation
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b".-".contains(&byte))
        }
    }
}

impl PlannerCommand {
    pub fn validate(&self) -> ResearchResult<()> {
        let valid = self.schema == "affect-research-planner-command"
            && self.version == 1
            && is_uuid(&self.session_id)
            && is_uuid(&self.request_id)
            && self
                .expected_revision
                .is_none_or(|value| value <= MAX_SAFE_REVISION)
            && match &self.action {
                PlannerAction::Catalogue | PlannerAction::Snapshot => true,
                PlannerAction::Get { field: name } => field(name),
                PlannerAction::Validate { owner: id } => id.as_ref().is_none_or(|id| owner(id)),
                PlannerAction::Set { field: name, .. } => {
                    field(name) && self.expected_revision.is_some()
                }
                PlannerAction::Apply { edits } => {
                    self.expected_revision.is_some()
                        && !edits.is_empty()
                        && edits.len() <= 256
                        && edits.iter().all(edit_valid)
                }
                PlannerAction::Cancel { request_id } => is_uuid(request_id),
            };
        if valid {
            Ok(())
        } else {
            Err(CommandError::new(
                "malformed_command",
                "Planner command identity, action or revision is invalid.",
            ))
        }
    }
}

/// Reject duplicates before converting to DTOs, including nested JSON-valued
/// authored fields. serde_json::Value alone silently retains the last duplicate.
struct UniqueJson(Value);
impl<'de> Deserialize<'de> for UniqueJson {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct JsonVisitor;
        impl<'de> Visitor<'de> for JsonVisitor {
            type Value = UniqueJson;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("JSON without duplicate keys")
            }
            fn visit_bool<E: serde::de::Error>(self, value: bool) -> Result<Self::Value, E> {
                Ok(UniqueJson(value.into()))
            }
            fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<Self::Value, E> {
                Ok(UniqueJson(value.into()))
            }
            fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<Self::Value, E> {
                Ok(UniqueJson(value.into()))
            }
            fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<Self::Value, E> {
                serde_json::Number::from_f64(value)
                    .map(|number| UniqueJson(Value::Number(number)))
                    .ok_or_else(|| E::custom("nonfinite JSON"))
            }
            fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Self::Value, E> {
                Ok(UniqueJson(value.into()))
            }
            fn visit_string<E: serde::de::Error>(self, value: String) -> Result<Self::Value, E> {
                Ok(UniqueJson(value.into()))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(UniqueJson(Value::Null))
            }
            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut sequence: A,
            ) -> Result<Self::Value, A::Error> {
                let mut values = Vec::new();
                while let Some(UniqueJson(value)) = sequence.next_element()? {
                    values.push(value);
                }
                Ok(UniqueJson(Value::Array(values)))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                let mut values = Map::new();
                while let Some(key) = map.next_key::<String>()? {
                    if values.contains_key(&key) {
                        return Err(serde::de::Error::custom("duplicate JSON key"));
                    }
                    let UniqueJson(value) = map.next_value()?;
                    values.insert(key, value);
                }
                Ok(UniqueJson(Value::Object(values)))
            }
        }
        deserializer.deserialize_any(JsonVisitor)
    }
}

pub fn parse_command(bytes: &[u8]) -> ResearchResult<PlannerCommand> {
    if bytes.is_empty() || bytes.len() > MAX_FRAME_BYTES {
        return Err(CommandError::new(
            "limit_exceeded",
            "Command frame must contain 1 byte to 16 MiB.",
        ));
    }
    let UniqueJson(value) = serde_json::from_slice(bytes).map_err(|_| {
        CommandError::new(
            "malformed_command",
            "Command must be strict UTF-8 JSON without duplicate or trailing values.",
        )
    })?;
    if !check_json(&value, 0)
        || value.get("expectedRevision").is_none()
        || (value.pointer("/action/kind").and_then(Value::as_str) == Some("validate")
            && value.pointer("/action/owner").is_none())
    {
        return Err(CommandError::new(
            "malformed_command",
            "Command JSON shape is invalid.",
        ));
    }
    let command: PlannerCommand = serde_json::from_value(value).map_err(|_| {
        CommandError::new(
            "malformed_command",
            "Command contains unknown or missing fields.",
        )
    })?;
    command.validate()?;
    Ok(command)
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannerResponse {
    pub schema: String,
    pub version: u8,
    pub session_id: String,
    pub request_id: String,
    pub status: String,
    pub revision: u64,
    pub result: Value,
    pub issues: Vec<Value>,
}
impl PlannerResponse {
    pub fn validate(&self) -> ResearchResult<()> {
        if self.schema != "affect-research-planner-command-result"
            || self.version != 1
            || !is_uuid(&self.session_id)
            || !is_uuid(&self.request_id)
            || self.revision > MAX_SAFE_REVISION
            || !matches!(
                self.status.as_str(),
                "ok" | "applied" | "incomplete" | "rejected" | "canceled"
            )
            || self.issues.len() > 512
            || !check_json(&self.result, 0)
            || !self.issues.iter().all(|issue| check_json(issue, 0))
        {
            return Err(CommandError::new(
                "invalid_response",
                "Planner returned an invalid command result.",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> String {
        serde_json::json!({"schema":"affect-research-planner-command","version":1,"sessionId":Uuid::new_v4().to_string(),"requestId":Uuid::new_v4().to_string(),"expectedRevision":0,"action":{"kind":"set","field":"P7.participantCount","value":42}}).to_string()
    }
    #[test]
    fn strict_framing_and_closed_actions() {
        let input = request();
        assert!(parse_command(input.as_bytes()).is_ok());
        for malformed in [
            format!("{input}{{}}"),
            input.replace("\"version\":1", "\"version\":1,\"version\":1"),
            input.replace("\"value\":42", "\"value\":{\"x\":1,\"x\":2}"),
            input.replace("\"set\"", "\"eval\""),
            input.replace("\"expectedRevision\":0", "\"expectedRevision\":null"),
            input.replace("\"P7.participantCount\"", "\"__proto__.x\""),
            input.replace("\"value\":42", "\"value\":{\"constructor\":1}"),
        ] {
            assert!(parse_command(malformed.as_bytes()).is_err());
        }
        assert!(parse_command(&[0xff]).is_err());
        assert!(parse_command(&vec![b' '; MAX_FRAME_BYTES + 1]).is_err());
        let mut nullable: Value = serde_json::from_str(&input).unwrap();
        nullable["action"] = serde_json::json!({"kind":"validate"});
        assert!(parse_command(nullable.to_string().as_bytes()).is_err());
        nullable["action"]["owner"] = Value::Null;
        assert!(parse_command(nullable.to_string().as_bytes()).is_ok());
        for id in [
            "00000000-0000-0000-8000-000000000000",
            "00000000-0000-4000-0000-000000000000",
            "00000000-0000-9000-8000-000000000000",
        ] {
            assert!(!is_uuid(id));
        }
    }
}
