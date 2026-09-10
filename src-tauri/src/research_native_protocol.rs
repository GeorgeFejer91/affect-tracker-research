//! Native package/protocol composition boundary.
//!
//! This module owns the typed protocol selected from one canonical
//! `ExperimentPackageV1`.  Runtime execution, persistence, and Tauri commands
//! are separate submodules so contract policy never leaks into the platform
//! adapter.

pub(crate) mod commands;
pub(crate) mod compiler;
pub(crate) mod contracts;
pub(crate) mod input_mailbox;
pub(crate) mod records;
pub(crate) mod recovery;
pub(crate) mod reducer;
pub(crate) mod responses;
pub(crate) mod runtime;
pub(crate) mod storage;
