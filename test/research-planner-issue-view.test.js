import test from "node:test";
import assert from "node:assert/strict";
import { groupPlannerContributionIssues } from "../site/src/research/planner-issue-view.js";

test("Review groups owners while retaining distinct dependency diagnostics and input order", () => {
  const issues = Object.freeze([
    { segment: "P3", code: "contribution-pending", message: "P3: accept the current edits before exporting." },
    { segment: "P3", code: "successor-required", message: "P3: this active contribution requires a successor recipe contract; v1 cannot include it." },
    { segment: "P1", code: "contribution-pending", message: "P1: accept the current edits before exporting." },
    { segment: "P3", code: "dependency-stale", message: "P3: review its dependency on P1; the accepted revision is unavailable or changed." },
    { segment: "P3", code: "dependency-stale", message: "P3: its dependency on P2 is invalid." },
  ].map(Object.freeze));
  const groups = groupPlannerContributionIssues(issues);
  assert.deepEqual(groups.map(({ segment }) => segment), ["P3", "P1"]);
  assert.equal(groups[0].issues.length, 4);
  assert.equal(groups[0].summary, "Confirm edits · Recipe format unavailable · Review dependencies");
  assert.equal(groups[0].issues[2].message, "review its dependency on Workspace; the accepted revision is unavailable or changed.");
  assert.equal(groups[0].issues[3].message, "its dependency on Questionnaires is invalid.");
  assert.deepEqual(groups.flatMap(group => group.issues.map(issue => issue.sourceMessage)).sort(), issues.map(issue => issue.message).sort());
});

test("Review removes only identical diagnostics, retaining unknown codes and exact detail content", () => {
  const issue = { segment: "P4", code: "new-field-error", message: "P4: Screen width must be positive; Flubber extends beyond Video 2." };
  const groups = groupPlannerContributionIssues([issue, { ...issue }, { ...issue, message: "P4: Screen height must be positive." }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].summary, "Review issue");
  assert.deepEqual(groups[0].issues.map(({ message }) => message), [
    "Screen width must be positive; Flubber extends beyond Video 2.", "Screen height must be positive.",
  ]);
  assert.deepEqual(groupPlannerContributionIssues([]), []);
});
