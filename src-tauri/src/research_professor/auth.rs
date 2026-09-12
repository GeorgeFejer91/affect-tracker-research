//! Native verification of the pinned BRSP/1 hello transcript. No frontend auth flags.
use super::{error, Result};
use crate::research_contracts::canonical_json;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::time::{Duration, Instant};
use uuid::Uuid;

pub const SCOPES: [&str; 3] = ["runner.observe", "runner.operate", "runner.video"];
pub const CAPS: [&str; 3] = ["command-ack", "latest-state", "state-snapshot"];
const INVITE_TTL: Duration = Duration::from_secs(120);
const GRANT_TTL: Duration = Duration::from_secs(7200);

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Envelope<T> {
    pub protocol: String,
    pub version: u32,
    pub r#type: String,
    pub session_id: String,
    pub sender_id: String,
    pub sender_epoch: u32,
    pub sequence: u32,
    pub body: T,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Hello {
    pub role: String,
    pub nonce: String,
    pub capabilities: Vec<String>,
    pub requested_scopes: Vec<String>,
    pub granted_scopes: Vec<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Proof {
    pub algorithm: String,
    pub role: String,
    pub value: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VerifyRequest {
    pub controller_hello: Envelope<Hello>,
    pub proof: Envelope<Proof>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Invitation {
    pub room: String,
    pub session: String,
    pub stream: String,
    pub secret: String,
    pub target_hello: Envelope<Hello>,
    pub expires_in_seconds: u32,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub handle: String,
    pub scopes: Vec<String>,
}
pub struct Session {
    secret: String,
    pub hello: Envelope<Hello>,
    created: Instant,
    grant: Option<(Grant, Envelope<Hello>, Instant)>,
}
fn random_secret() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}
fn token(value: &str, min: usize, max: usize) -> bool {
    value.len() >= min
        && value.len() <= max
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b))
}
fn tokens(values: &[String]) -> bool {
    values.len() <= 32
        && values.iter().all(|v| token(v, 1, 64))
        && values
            .iter()
            .enumerate()
            .all(|(i, v)| !values[..i].contains(v))
}
#[cfg(test)]
pub(super) fn fixture_session() -> (Session, Grant) {
    let v: serde_json::Value =
        serde_json::from_str(include_str!("../../../test/fixtures/professor-proof.json")).unwrap();
    let now = Instant::now();
    let mut session = Session {
        secret: v["secret"].as_str().unwrap().into(),
        hello: serde_json::from_value(v["targetHello"].clone()).unwrap(),
        created: now,
        grant: None,
    };
    let request = serde_json::from_value(
        serde_json::json!({"controllerHello":v["controllerHello"],"proof":v["proof"]}),
    )
    .unwrap();
    let grant = session.verify(request, now).unwrap();
    (session, grant)
}
impl Session {
    pub fn begin(video: bool, now: Instant) -> (Self, Invitation) {
        let secret = random_secret();
        let session = format!("professor_{}", Uuid::new_v4().simple());
        let hello = Envelope {
            protocol: "brsp".into(),
            version: 1,
            r#type: "hello".into(),
            session_id: session.clone(),
            sender_id: format!("target_{}", Uuid::new_v4().simple()),
            sender_epoch: u32::from_le_bytes(
                Uuid::new_v4().as_bytes()[..4].try_into().unwrap_or([0; 4]),
            ),
            sequence: 0,
            body: Hello {
                role: "target".into(),
                nonce: random_secret(),
                capabilities: CAPS.iter().map(|s| (*s).into()).collect(),
                requested_scopes: vec![],
                granted_scopes: SCOPES[..if video { 3 } else { 2 }]
                    .iter()
                    .map(|s| (*s).into())
                    .collect(),
            },
        };
        let invitation = Invitation {
            room: format!("professor_{}", Uuid::new_v4().simple()),
            session,
            stream: format!("brsp_target_{}", Uuid::new_v4().simple()),
            secret: secret.clone(),
            target_hello: hello.clone(),
            expires_in_seconds: 120,
        };
        (
            Self {
                secret,
                hello,
                created: now,
                grant: None,
            },
            invitation,
        )
    }
    pub fn verify(&mut self, request: VerifyRequest, now: Instant) -> Result<Grant> {
        let controller = &request.controller_hello;
        let proof = &request.proof;
        if now.duration_since(self.created) >= INVITE_TTL && self.grant.is_none() {
            return Err(error("invitation_expired"));
        }
        if let Some((grant, old_hello, expires)) = &self.grant {
            if old_hello != controller || now >= *expires {
                return Err(error("controller_busy"));
            }
            // Still verify the proof on an identical repeat; never accept just identity.
            let _ = grant;
        }
        if controller.protocol != "brsp"
            || controller.version != 1
            || controller.r#type != "hello"
            || controller.session_id != self.hello.session_id
            || controller.sequence != 0
            || !token(&controller.sender_id, 8, 96)
            || controller.sender_id == self.hello.sender_id
            || controller.body.role != "controller"
            || !controller.body.granted_scopes.is_empty()
            || !token(&controller.body.nonce, 20, 96)
            || !controller
                .body
                .nonce
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
            || !tokens(&controller.body.capabilities)
            || !tokens(&controller.body.requested_scopes)
            || proof.protocol != "brsp"
            || proof.version != 1
            || proof.r#type != "proof"
            || proof.session_id != self.hello.session_id
            || proof.sender_id != controller.sender_id
            || proof.sender_epoch != controller.sender_epoch
            || proof.sequence == 0
            || proof.body.algorithm != "HMAC-SHA-256"
            || proof.body.role != "controller"
            || proof.body.value.len() != 43
        {
            return Err(error("authentication_failed"));
        }
        let transcript = canonical_json(&serde_json::json!({ "protocol": "brsp", "version": 1,
            "sessionId": self.hello.session_id, "targetHello": self.hello, "controllerHello": controller }), &[])
            .map_err(|_| error("authentication_failed"))?;
        let mut mac = Hmac::<Sha256>::new_from_slice(self.secret.as_bytes())
            .map_err(|_| error("authentication_failed"))?;
        mac.update(b"BRSP/1 proof\ncontroller\n");
        mac.update(&transcript);
        let bytes = URL_SAFE_NO_PAD
            .decode(&proof.body.value)
            .map_err(|_| error("authentication_failed"))?;
        mac.verify_slice(&bytes)
            .map_err(|_| error("authentication_failed"))?;
        if let Some((grant, _, _)) = &self.grant {
            return Ok(grant.clone());
        }
        let scopes: Vec<String> = self
            .hello
            .body
            .granted_scopes
            .iter()
            .filter(|s| controller.body.requested_scopes.contains(s))
            .cloned()
            .collect();
        if !scopes.iter().any(|s| s == "runner.observe")
            || !CAPS
                .iter()
                .all(|c| controller.body.capabilities.iter().any(|s| s == c))
        {
            return Err(error("scope_denied"));
        }
        let grant = Grant {
            handle: random_secret(),
            scopes,
        };
        self.grant = Some((grant.clone(), controller.clone(), now + GRANT_TTL));
        Ok(grant)
    }
    pub fn require(&self, handle: &str, scope: &str, now: Instant) -> Result<()> {
        match &self.grant {
            Some((grant, _, expiry))
                if handle == grant.handle
                    && now < *expiry
                    && grant.scopes.iter().any(|s| s == scope) =>
            {
                Ok(())
            }
            _ => Err(error("grant_expired_or_revoked")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(now: Instant) -> (Session, serde_json::Value) {
        let v: serde_json::Value =
            serde_json::from_str(include_str!("../../../test/fixtures/professor-proof.json"))
                .unwrap();
        (
            Session {
                secret: v["secret"].as_str().unwrap().into(),
                hello: serde_json::from_value(v["targetHello"].clone()).unwrap(),
                created: now,
                grant: None,
            },
            v,
        )
    }
    fn request(v: &serde_json::Value) -> VerifyRequest {
        serde_json::from_value(
            serde_json::json!({"controllerHello":v["controllerHello"],"proof":v["proof"]}),
        )
        .unwrap()
    }
    #[test]
    fn javascript_canonical_hmac_fixture_is_verified_by_rust() {
        let now = Instant::now();
        let (mut session, v) = fixture(now);
        let transcript=canonical_json(&serde_json::json!({"protocol":"brsp","version":1,"sessionId":session.hello.session_id,"targetHello":session.hello,"controllerHello":v["controllerHello"]}), &[]).unwrap();
        assert_eq!(
            String::from_utf8(transcript).unwrap(),
            v["transcript"].as_str().unwrap()
        );
        let grant = session.verify(request(&v), now).unwrap();
        assert!(session
            .require(&grant.handle, "runner.operate", now)
            .is_ok());
        assert!(session
            .require(&grant.handle, "participant.input", now)
            .is_err());
        assert!(session
            .require("copied_frontend_flag", "runner.observe", now)
            .is_err());
        assert_eq!(
            grant.handle,
            session.verify(request(&v), now).unwrap().handle
        );
        assert!(session
            .require(&grant.handle, "runner.observe", now + GRANT_TTL)
            .is_err());
    }
    #[test]
    fn altered_transcripts_reflected_roles_and_expired_invitations_fail() {
        let now = Instant::now();
        for field in ["nonce", "role"] {
            let (mut session, mut v) = fixture(now);
            v["controllerHello"]["body"][field] =
                serde_json::json!("target_nonce_altered_1234567890");
            assert!(session.verify(request(&v), now).is_err());
        }
        let (mut session, mut v) = fixture(now);
        v["proof"]["body"]["value"] = serde_json::json!("A".repeat(43));
        assert!(session.verify(request(&v), now).is_err());
        let (mut session, v) = fixture(now);
        assert!(session.verify(request(&v), now + INVITE_TTL).is_err());
        let (mut session, mut v) = fixture(now);
        v["controllerHello"]["senderEpoch"] = serde_json::json!(1);
        assert!(session.verify(request(&v), now).is_err());
    }
    #[test]
    fn native_invitations_rotate_and_do_not_serialize_grant_as_public_state() {
        let now = Instant::now();
        let (_, a) = Session::begin(true, now);
        let (_, b) = Session::begin(false, now);
        assert_ne!(a.secret, b.secret);
        assert_ne!(a.session, b.session);
        assert_eq!(a.secret.len(), 64);
        assert!(!b
            .target_hello
            .body
            .granted_scopes
            .iter()
            .any(|s| s == "runner.video"));
        let mut v = serde_json::to_value(b.target_hello).unwrap();
        v["body"]["setValence"] = serde_json::json!(1);
        assert!(serde_json::from_value::<Envelope<Hello>>(v).is_err());
    }
}
