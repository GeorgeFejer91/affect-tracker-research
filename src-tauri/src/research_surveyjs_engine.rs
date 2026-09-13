//! Fixed, bundled SurveyJS core. Imported JSON is data, never executable source.
#![forbid(unsafe_code)]
use crate::research_error::{CommandError, ResearchResult};
use boa_engine::{Context, JsValue, Script, Source};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::future::Future;
use std::pin::pin;
use std::sync::{mpsc, OnceLock};
use std::task::{Context as TaskContext, Poll, Waker};
use std::time::{Duration, Instant};

const ENGINE: &str = include_str!("../surveyjs/engine.js");
const ENGINE_HASH: &str = include_str!("../surveyjs/engine.sha256");
const MAX_JSON: usize = 4 * 1024 * 1024;
type Reply = Result<Value, String>;
struct Request {
    value: Value,
    reply: mpsc::SyncSender<Reply>,
}
static SERVICE: OnceLock<Result<mpsc::SyncSender<Request>, String>> = OnceLock::new();

fn invalid(message: impl Into<String>) -> CommandError {
    CommandError::invalid_contract(message.into())
}

fn evaluate(context: &mut Context, source: &str, duration: Duration) -> Result<JsValue, String> {
    let deadline = Instant::now() + duration;
    let script = Script::parse(Source::from_bytes(source), None, context)
        .map_err(|_| "SurveyJS engine script failed to parse.")?;
    let mut task = TaskContext::from_waker(Waker::noop());
    let mut future = pin!(script.evaluate_async_with_budget(context, 16_384));
    loop {
        if Instant::now() >= deadline {
            return Err("SurveyJS validation exceeded its execution deadline.".into());
        }
        match future.as_mut().poll(&mut task) {
            Poll::Ready(value) => {
                return value
                    .map_err(|_| "SurveyJS execution failed or exceeded its limits.".into())
            }
            Poll::Pending => std::thread::yield_now(),
        }
    }
}

fn create_context() -> Result<Context, String> {
    if format!("{:x}", Sha256::digest(ENGINE.as_bytes())) != ENGINE_HASH.trim() {
        return Err("Bundled SurveyJS engine integrity mismatch.".into());
    }
    let mut context = Context::default();
    context
        .runtime_limits_mut()
        .set_loop_iteration_limit(1_000_000);
    context.runtime_limits_mut().set_recursion_limit(512);
    context.runtime_limits_mut().set_stack_size_limit(262_144);
    evaluate(&mut context, ENGINE, Duration::from_secs(30))?;
    Ok(context)
}

fn execute(context: &mut Context, input: Value) -> Reply {
    let text = serde_json::to_string(&input).map_err(|_| "Invalid SurveyJS request JSON.")?;
    // serde_json escapes the string argument; no imported text is concatenated
    // as JavaScript expressions. The only callable is the fixed bundled facade.
    let argument = serde_json::to_string(&text).map_err(|_| "Invalid SurveyJS string argument.")?;
    let result = evaluate(
        context,
        &format!("affectSurveyJS({argument})"),
        Duration::from_secs(10),
    )?;
    let text = result
        .as_string()
        .ok_or("SurveyJS returned a non-string result.")?
        .to_std_string_escaped();
    if text.len() > MAX_JSON * 2 {
        return Err("SurveyJS response exceeds its byte limit.".into());
    }
    let response: Value =
        serde_json::from_str(&text).map_err(|_| "SurveyJS returned invalid JSON.")?;
    if response["ok"] != true {
        return Err(response["message"]
            .as_str()
            .unwrap_or("SurveyJS validation rejected this questionnaire.")
            .chars()
            .take(4096)
            .collect());
    }
    Ok(response["result"].clone())
}

fn service() -> ResearchResult<&'static mpsc::SyncSender<Request>> {
    SERVICE
        .get_or_init(|| {
            let (sender, receiver) = mpsc::sync_channel::<Request>(8);
            std::thread::Builder::new()
                .name("surveyjs-core".into())
                .stack_size(32 * 1024 * 1024)
                .spawn(move || {
                    let mut context = create_context();
                    while let Ok(request) = receiver.recv() {
                        let result = match &mut context {
                            Ok(context) => execute(context, request.value),
                            Err(error) => Err(error.clone()),
                        };
                        // Discard an interrupted VM before accepting the next operation.
                        let restart = result.as_ref().err().is_some_and(|e| {
                            e.contains("deadline") || e.contains("execution failed")
                        });
                        let _ = request.reply.send(result);
                        if restart {
                            context = create_context();
                        }
                    }
                })
                .map_err(|_| "Could not initialize the SurveyJS validation worker.".to_owned())?;
            Ok(sender)
        })
        .as_ref()
        .map_err(|error| invalid(error.clone()))
}

pub(crate) fn surveyjs_request(value: Value) -> ResearchResult<Value> {
    if serde_json::to_vec(&value)
        .map_err(|_| invalid("Invalid SurveyJS request."))?
        .len()
        > MAX_JSON * 2 + 1024
    {
        return Err(invalid("SurveyJS request exceeds its byte limit."));
    }
    let (reply, response) = mpsc::sync_channel(1);
    service()?
        .try_send(Request { value, reply })
        .map_err(|_| invalid("SurveyJS validation is busy or unavailable."))?;
    response
        .recv_timeout(Duration::from_secs(45))
        .map_err(|_| invalid("SurveyJS validation did not finish; no response was accepted."))?
        .map_err(invalid)
}

pub(crate) fn inspect_survey_json(json: &Value) -> ResearchResult<Value> {
    surveyjs_request(json!({"operation":"inspect", "surveyJson":json}))
}
#[cfg(test)]
fn validate_survey_data(
    json: &Value,
    language: &str,
    data: &Value,
    complete: bool,
) -> ResearchResult<Value> {
    validate_survey_data_seed(json, language, data, complete, 1)
}
pub(crate) fn validate_survey_data_seed(
    json: &Value,
    language: &str,
    data: &Value,
    complete: bool,
    random_seed: u32,
) -> ResearchResult<Value> {
    surveyjs_request(
        json!({"operation":"check", "surveyJson":json, "language":language, "data":data, "complete":complete,"randomSeed":random_seed}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_surveyjs_retains_nested_calculations_matrices_and_inline_files() {
        let schema = json!({"elements":[
            {"type":"paneldynamic","name":"rows","templateElements":[{"type":"text","inputType":"number","name":"amount"}]},
            {"type":"expression","name":"total","expression":"sumInArray({rows}, 'amount')"},
            {"type":"matrixdropdown","name":"matrix","rows":["first"],"columns":[{"name":"answer","cellType":"text"}]},
            {"type":"ranking","name":"rank","choices":["a","b"]},
            {"type":"file","name":"attachment","storeDataAsText":true}
        ]});
        let data = json!({"rows":[{"amount":2},{"amount":3}],"matrix":{"first":{"answer":"nested answer"}},"rank":["b","a"],
            "attachment":[{"name":"note.txt","type":"text/plain","content":"data:text/plain;base64,aGVsbG8="}]});
        let checked = surveyjs_request(
            json!({"operation":"check","surveyJson":schema,"language":"de","data":data,
            "complete":true,"randomSeed":42,"evaluatedAtUnixMs":1789250000000_u64}),
        )
        .unwrap();
        assert_eq!(checked["data"]["total"], 5);
        assert_eq!(checked["data"]["matrix"], data["matrix"]);
        assert_eq!(checked["data"]["attachment"], data["attachment"]);
        assert_eq!(checked["data"]["rank"], data["rank"]);
        assert_eq!(checked["evaluatedAtUnixMs"], 1789250000000_u64);
        let mut incomplete = data;
        incomplete["matrix"] = json!({"first":{}});
        assert!(validate_survey_data(&schema, "de", &incomplete, true).is_err());
    }
    #[test]
    fn native_bundled_surveyjs_executes_conditional_pages_and_validation() {
        let schema = json!({"pages":[{"elements":[{"type":"boolean","name":"details"}]},{"visibleIf":"{details} = true","elements":[{"type":"text","name":"answer"}]}]});
        assert_eq!(inspect_survey_json(&schema).unwrap()["questionCount"], 2);
        assert_eq!(
            validate_survey_data(&schema, "en", &json!({"details":false}), true).unwrap()["valid"],
            true
        );
        assert!(validate_survey_data(&schema, "en", &json!({"details":true}), true).is_err());
        assert_eq!(
            validate_survey_data(
                &schema,
                "en",
                &json!({"details":true,"answer":"given"}),
                true
            )
            .unwrap()["data"]["answer"],
            "given"
        );
    }
}
