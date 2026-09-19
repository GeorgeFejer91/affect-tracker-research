// Exercise the exact owner module before Main adds its lib.rs registration.
// This harness introduces no alternate error or filesystem implementation.
#[path = "../src/research_error.rs"]
mod research_error;
#[path = "../src/research_planner_cli_io.rs"]
mod research_planner_cli_io;
