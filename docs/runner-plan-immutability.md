# Runner published-plan immutability

2026-10-04 R1/RR-10 source pass on `codex/r1-plan-immutability`.

`resolveMasterPlan` reconstructs the selected P1–P7 contract from the exact
saved master, computes the plan identity, and now recursively freezes the
published selector, selected settings, ordered steps and payloads using the
existing JSON freeze helper. The recipe, saved bytes, hash calculation,
selection rules and native Start protocol are unchanged. The former root-only
freeze allowed a frontend consumer to change a nested step after the hash had
already been computed.

Checks: focused Runner/Face tests **12/12**; complete JavaScript suite
**1,233/1,233**. The new test covers master1–4 fixture
plans, attempts edits to the selector, P5 settings and a step, and rebuilds the
same selection to compare plan identity and order. The existing correspondence
probe now reports frozen `steps`, first step and selector. These are software
checks; exact native Start, playback, physical display, LSL and XDF remain open.
