import { canonicalJson } from "./canonical.js";
import { commandFailure, validateCommandJson, validateSettingValue } from "./planner-authoring-contract.js";
import { createStudyIdentityV1 } from "./study-identity.js";
import { WORKSPACE_RELATIVE_LAYOUT_V1 } from "./workspace-contribution.js";

const STUDY_FIELDS = Object.freeze([
  Object.freeze({
    id: "P1.study.id",
    type: "string",
    classification: "authored",
    writable: true,
    maxLength: 128,
    label: "Study ID",
    uiControl: "#experiment-id",
    recipePath: "segments.P1.study.id",
  }),
  Object.freeze({
    id: "P1.study.title",
    type: "string",
    classification: "authored",
    writable: true,
    maxLength: 200,
    label: "Study title",
    uiControl: "#experiment-title",
    recipePath: "segments.P1.study.title",
  }),
]);

const DERIVED_FIELDS = Object.freeze([
  Object.freeze({ id: "P1.workspace.selected", type: "boolean", classification: "derived", writable: false, label: "Work directory selected", uiControl: "#workspace-root", recipePath: null }),
  Object.freeze({ id: "P1.workspace.displayName", type: "string", classification: "derived", writable: false, label: "Work directory", uiControl: "#workspace-root", recipePath: null }),
  Object.freeze({ id: "P1.workspace.layout", type: "json", classification: "derived", writable: false, label: "Portable project layout", uiControl: ".workspace-location-list", recipePath: "segments.P1.workspaceLayout" }),
  Object.freeze({ id: "P1.workspace.snapshot", type: "json", classification: "derived", writable: false, label: "Workspace contribution state", uiControl: "#workspace-status", recipePath: "segments.P1" }),
  Object.freeze({ id: "P1.media.pending", type: "boolean", classification: "derived", writable: false, label: "Video verification pending", uiControl: "#workspace-status", recipePath: null }),
  Object.freeze({ id: "P1.media.ready", type: "boolean", classification: "derived", writable: false, label: "Video catalogue ready", uiControl: "#workspace-status", recipePath: null }),
  Object.freeze({ id: "P1.media.count", type: "integer", classification: "derived", writable: false, label: "Verified video locations", uiControl: "#stimulus-library-table", recipePath: "segments.P1.videoCatalogue.entries" }),
  Object.freeze({ id: "P1.media.catalogue", type: "json", classification: "derived", writable: false, label: "Verified video catalogue", uiControl: "#stimulus-library-table", recipePath: "segments.P1.videoCatalogue" }),
]);

export const P1_PLANNER_OPERATIONS = Object.freeze([
  Object.freeze({
    id: "selectWorkspace",
    label: "Select work directory",
    consequential: true,
    atomic: false,
    uiControl: "#workspace-choose",
    uiAction: "Set work directory",
    recipeOutcome: "segments.P1 is regenerated after the native grant is adopted and media is freshly verified; no absolute path is serialized.",
    arguments: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze(["workspaceGrantId"]),
      properties: Object.freeze({ workspaceGrantId: Object.freeze({ type: "string", format: "uuid" }) }),
    }),
  }),
  Object.freeze({
    id: "importVideos",
    label: "Import video files or folder",
    consequential: true,
    atomic: false,
    uiControl: Object.freeze({ videos: "#video-import", folder: "#video-folder-import" }),
    uiAction: "Add video files / Add video folder",
    recipeOutcome: "Freshly verified locations replace segments.P1.videoCatalogue.entries; hashes, duration, and oriented geometry stay derived.",
    arguments: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze(["selectionKind", "selectionGrantId"]),
      properties: Object.freeze({
        selectionKind: Object.freeze({ type: "string", enum: Object.freeze(["videos", "folder"]) }),
        selectionGrantId: Object.freeze({ type: "string", format: "uuid" }),
      }),
    }),
  }),
  Object.freeze({
    id: "rescanVideoLibrary",
    label: "Rescan video library",
    consequential: true,
    atomic: false,
    uiControl: "#workspace-rescan",
    uiAction: "Rescan library",
    recipeOutcome: "The current authorized directory is re-enumerated and segments.P1.videoCatalogue is replaced only after exact fresh verification.",
    arguments: Object.freeze({ type: "object", additionalProperties: false, required: Object.freeze([]), properties: Object.freeze({}) }),
  }),
]);

const SNAPSHOT_KEYS = Object.freeze(["revision", "enabled", "pending", "contribution", "dependencyRevisions"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function exactObject(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function issue(code, message, field = null) {
  return Object.freeze({ owner: "P1", field, code, message });
}

function normalizedDraft(readStudyDraft) {
  const value = readStudyDraft();
  if (!exactObject(value, ["id", "title"])
    || typeof value.id !== "string" || typeof value.title !== "string") {
    commandFailure("owner_unavailable", "The study identity editor is unavailable.", "P1.study.id");
  }
  return { id: value.id, title: value.title };
}

function normalizedSelection(readWorkspaceSelection) {
  const value = readWorkspaceSelection();
  if (!exactObject(value, ["selected", "label"])
    || typeof value.selected !== "boolean"
    || (value.label !== null && typeof value.label !== "string")) {
    commandFailure("owner_unavailable", "The work-directory selection state is unavailable.", "P1.workspace.selected");
  }
  return { selected: value.selected, label: value.label ?? "" };
}

function normalizedSnapshot(getWorkspaceContributionSnapshot) {
  const value = getWorkspaceContributionSnapshot();
  if (!exactObject(value, SNAPSHOT_KEYS)
    || !Number.isSafeInteger(value.revision) || value.revision < 0
    || typeof value.enabled !== "boolean" || typeof value.pending !== "boolean"
    || !Array.isArray(value.dependencyRevisions) || value.dependencyRevisions.length !== 0
    || (value.contribution !== null && (typeof value.contribution !== "object" || Array.isArray(value.contribution)))) {
    commandFailure("owner_unavailable", "The workspace contribution state is unavailable.", "P1.workspace.snapshot");
  }
  validateCommandJson(value);
  return structuredClone(value);
}

function studyIssues(draft) {
  try {
    createStudyIdentityV1(draft);
    return [];
  } catch (error) {
    let field = "P1.study.title";
    try { createStudyIdentityV1({ id: draft.id, title: "Valid title" }); }
    catch { field = "P1.study.id"; }
    return [issue("invalid_study_identity", String(error.message).slice(0, 512), field)];
  }
}

function stateIssues(draft, selection, snapshot) {
  if (!selection.selected) {
    return [issue("workspace_unselected", "Select a work directory before confirming Workspace & Video Library.", "P1.workspace.selected")];
  }
  if (!snapshot.enabled || snapshot.pending || snapshot.contribution === null) {
    return [issue("media_pending", "Import or rescan the video library and wait for complete media verification.", "P1.media.catalogue")];
  }
  const contribution = snapshot.contribution;
  if (!exactObject(contribution.workspaceLayout, ["assetRoot", "videoLibrary", "projectFile"])
    || canonicalJson(contribution.workspaceLayout) !== canonicalJson(WORKSPACE_RELATIVE_LAYOUT_V1)
    || !Array.isArray(contribution.videoCatalogue?.entries)) {
    return [issue("workspace_invalid", "The current workspace contribution is malformed.", "P1.workspace.snapshot")];
  }
  try {
    if (canonicalJson(contribution.study) !== canonicalJson(createStudyIdentityV1(draft))) {
      return [issue("workspace_stale", "The workspace contribution has not published the current study identity.", "P1.workspace.snapshot")];
    }
  } catch { /* The study issue already identifies an incomplete draft. */ }
  return [];
}

function exactOperationArguments(operation, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    commandFailure("invalid_operation_arguments", "Workspace operation arguments must be an object.", "P1");
  }
  if (["selectWorkspace", "rescanVideoLibrary"].includes(operation)) {
    if (operation === "selectWorkspace") {
      if (!exactObject(args, ["workspaceGrantId"]) || !UUID.test(args.workspaceGrantId ?? "")) {
        commandFailure("invalid_operation_arguments", "Workspace selection requires one native-issued workspaceGrantId UUID.", "P1");
      }
      return { workspaceGrantId: args.workspaceGrantId };
    }
    if (!exactObject(args, [])) commandFailure("invalid_operation_arguments", "Rescan takes no arguments.", "P1");
    return {};
  }
  if (operation === "importVideos") {
    if (!exactObject(args, ["selectionKind", "selectionGrantId"])
      || !["videos", "folder"].includes(args.selectionKind)
      || !UUID.test(args.selectionGrantId ?? "")) {
      commandFailure("invalid_operation_arguments", "Video import requires a closed selectionKind and one native-issued selectionGrantId UUID.", "P1");
    }
    return { selectionKind: args.selectionKind, selectionGrantId: args.selectionGrantId };
  }
  commandFailure("unknown_operation", "Unknown workspace operation.", "P1");
}

/**
 * CLI projection over the existing P1 draft and native workspace authority.
 * The injected commit is synchronous and nonthrowing after detached validation.
 * Publication and rendering are deferred to the synchronous after-commit hook,
 * after every owner in the atomic batch has installed its candidate.
 * Native picker/import/rescan work is exposed only through runOperation and is
 * deliberately rejected by stage(), keeping it outside atomic field edits.
 */
export function createPlannerWorkspaceCommandOwner({
  readStudyDraft,
  commitStudyDraft,
  afterCommitStudyDraft,
  readWorkspaceSelection,
  getWorkspaceContributionSnapshot,
  performWorkspaceOperation,
} = {}) {
  if (typeof readStudyDraft !== "function" || typeof commitStudyDraft !== "function"
    || typeof afterCommitStudyDraft !== "function"
    || typeof readWorkspaceSelection !== "function" || typeof getWorkspaceContributionSnapshot !== "function"
    || typeof performWorkspaceOperation !== "function") {
    throw new TypeError("Planner P1 command owner inputs are incomplete.");
  }
  const settings = Object.freeze([...STUDY_FIELDS, ...DERIVED_FIELDS]);

  function readState() {
    let draft = { id: "", title: "" };
    let selection = { selected: false, label: "" };
    let snapshot = null;
    const issues = [];
    try { draft = normalizedDraft(readStudyDraft); }
    catch (error) { issues.push(issue("owner_unavailable", error.message, error.field ?? "P1.study.id")); }
    try { selection = normalizedSelection(readWorkspaceSelection); }
    catch (error) { issues.push(issue("owner_unavailable", error.message, error.field ?? "P1.workspace.selected")); }
    try { snapshot = normalizedSnapshot(getWorkspaceContributionSnapshot); }
    catch (error) { issues.push(issue("owner_unavailable", error.message, error.field ?? "P1.workspace.snapshot")); }
    issues.push(...studyIssues(draft));
    if (snapshot) issues.push(...stateIssues(draft, selection, snapshot));
    const catalogue = snapshot?.contribution?.videoCatalogue ?? null;
    const ready = Boolean(selection.selected && snapshot?.enabled && !snapshot.pending && catalogue);
    return {
      values: {
        "P1.study.id": draft.id,
        "P1.study.title": draft.title,
        "P1.workspace.selected": selection.selected,
        "P1.workspace.displayName": selection.label,
        "P1.workspace.layout": structuredClone(WORKSPACE_RELATIVE_LAYOUT_V1),
        "P1.workspace.snapshot": snapshot,
        "P1.media.pending": !ready,
        "P1.media.ready": ready,
        "P1.media.count": ready && Array.isArray(catalogue.entries) ? catalogue.entries.length : 0,
        "P1.media.catalogue": ready ? structuredClone(catalogue) : null,
      },
      issues,
    };
  }

  return Object.freeze({
    id: "P1",
    settings,
    operations: P1_PLANNER_OPERATIONS,
    read() { return readState(); },
    validate() { return readState().issues; },
    async stage(edits, { isCurrent, signal }) {
      if (typeof isCurrent !== "function" || !signal || typeof signal.aborted !== "boolean") {
        commandFailure("malformed_command", "Workspace staging context is invalid.", "P1");
      }
      const candidate = normalizedDraft(readStudyDraft);
      const dependency = canonicalJson(normalizedSnapshot(getWorkspaceContributionSnapshot));
      for (const edit of edits) {
        if (edit.kind === "operation") {
          commandFailure("consequential_operation", "Workspace selection, import, and rescan run as separate native operations.", "P1");
        }
        const setting = STUDY_FIELDS.find(field => field.id === edit.field);
        if (!setting) commandFailure("unknown_setting", "Unknown Workspace & Video Library setting.", edit.field);
        validateSettingValue(setting, edit.value);
        candidate[setting.id === "P1.study.id" ? "id" : "title"] = edit.value;
      }
      await Promise.resolve();
      if (!isCurrent() || signal.aborted) commandFailure(signal.aborted ? "canceled" : "stale_revision", "Workspace staging is no longer current.", "P1");
      const dependencyIsCurrent = () => {
        try { return canonicalJson(normalizedSnapshot(getWorkspaceContributionSnapshot)) === dependency; }
        catch { return false; }
      };
      if (!dependencyIsCurrent()) {
        commandFailure("dependency_changed", "The workspace changed while the study edit was being prepared.", "P1.workspace.snapshot");
      }
      const committed = structuredClone(candidate);
      return Object.freeze({
        isCurrent: dependencyIsCurrent,
        commit() { commitStudyDraft(structuredClone(committed)); },
        afterCommit() { afterCommitStudyDraft(structuredClone(committed)); },
      });
    },
    async runOperation(operation, args, { isCurrent = () => true, signal = { aborted: false } } = {}) {
      const normalized = exactOperationArguments(operation, args);
      if (typeof isCurrent !== "function" || !signal || typeof signal.aborted !== "boolean") {
        commandFailure("malformed_command", "Workspace operation context is invalid.", "P1");
      }
      if (!isCurrent() || signal.aborted) commandFailure("canceled", "Workspace operation was cancelled before native work began.", "P1");
      const receipt = await performWorkspaceOperation(operation, structuredClone(normalized), { isCurrent, signal });
      validateCommandJson(receipt);
      if (!isCurrent() || signal.aborted) {
        commandFailure("operation_outcome_unknown", "The native workspace operation may have completed after the request became stale; read the current workspace before retrying.", "P1");
      }
      return structuredClone(receipt);
    },
  });
}
