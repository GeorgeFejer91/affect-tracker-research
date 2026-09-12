import { bootResearchUi } from "../../site/src/research/app.js";
import { canonicalJson, sha256Hex } from "../../site/src/research/canonical.js";
import recipe from "./planner-recipe-current-v1.canonical.json";
import template from "../../site/questionnaires/questionnaire-template.json";

// Actual app/session/owners; injected native boundary, never a filesystem claim.
const checks = [], errors = [];
const check = (name, condition) => { if (!condition) throw Error(name); checks.push(name); };
addEventListener("error", event => errors.push(event.message));
addEventListener("unhandledrejection", event => errors.push(String(event.reason)));
(async () => {
  const root = document.querySelector("main"); root.id = "research-app"; root.dataset.researchSurface = "tauri";
  bootResearchUi(); const ui = root.researchUi, session = ui.plannerAuthoringSession;
  const sourceText = `${canonicalJson(recipe)}\n`, sourceSha256 = await sha256Hex(new TextEncoder().encode(sourceText));
  const written = [];
  const workspaceId = crypto.randomUUID();
  const items = recipe.segments.P1.videoCatalogue.entries.map(entry => ({
    stimulus: { stimulusId: entry.assetId, title: entry.annotationId,
      source: { kind: "workspaceFile", relativePath: entry.sourceRelativePath, mimeType: "video/mp4",
        sha256: entry.sha256, byteLength: entry.byteLength, durationMs: entry.durationMs } },
    verified: true, decodeQualification: "verified", displayGeometry: entry.geometry,
  }));
  let selected = null;
  ui.connectPlannerNativeWorkspace({ getWorkspaceId: () => selected,
    prepareWorkspace(_receipt, { isCurrent }) { return { isCurrent, projection: { workspaceId, directoryPermission: true, label: "Synthetic workspace", surface: "tauri" }, commit() { selected = workspaceId; } }; },
    async prepareCatalogue(_receipt, { isCurrent }) { return { isCurrent, projection: { items, replace: true }, commit() {} }; },
  });
  ui.connectPlannerNativeEffects({ async execute(context, action, publication) {
    check("native dispatch sees current command", publication.isCurrent());
    if (action.type === "readRecipe") {
      publication.recordEffect({ operation: "openRecipe", outcome: "read" });
      return { sourceText, sourceSha256, byteLength: new TextEncoder().encode(sourceText).byteLength };
    }
    if (action.type === "writeRecipe") {
      written.push(action.sourceText);
      const document = JSON.parse(action.sourceText);
      publication.recordEffect({ operation: "saveRecipe", outcome: "saved", basename: "synthetic-copy.json" });
      return { basename: "synthetic-copy.json", receipt: { schema: "affect-research-planner-recipe-save-receipt", version: 1,
        recipeId: document.recipeId, definitionSha256: document.integrity.definitionSha256,
        canonicalSourceByteSha256: await sha256Hex(new TextEncoder().encode(action.sourceText)), byteLength: new TextEncoder().encode(action.sourceText).byteLength } };
    }
    if (["selectWorkspace", "rescanVideoLibrary", "importVideos", "importVideoFolder"].includes(action.type)) { publication.recordEffect({ operation: action.type, outcome: "synthetic" }); return {}; }
    if (action.type === "readQuestionnaire") {
      const bytes = new TextEncoder().encode(`${canonicalJson(template)}\n`);
      publication.recordEffect({ operation: "importQuestionnaire", outcome: "read" });
      return { grantId: action.grantId, logicalName: "questionnaire-template.json", format: "json", byteLength: bytes.length,
        sha256: await sha256Hex(bytes), bytesHex: Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("") };
    }
    if (action.type === "storeQuestionnaire") { publication.recordEffect({ operation: action.type, outcome: "synthetic" }); return { sourceSha256: action.sourceSha256 }; }
    throw Error(`Unexpected native action ${action.type}`);
  } });
  const perform = (operation, args) => session.execute({ schema: "affect-research-planner-command", version: 1,
    sessionId: session.sessionId, requestId: crypto.randomUUID(), expectedRevision: session.revision,
    action: { kind: "perform", operation, arguments: args } });
  const selection = await perform("selectWorkspace", { directory: crypto.randomUUID() });
  check(`workspace selection: ${JSON.stringify(selection)}`, selection.result?.published && selection.issues.every(issue => issue.code === "media_pending"));
  await new Promise(resolve => setTimeout(resolve, 200));
  const opened = await perform("openRecipe", { path: crypto.randomUUID() });
  check(`real app Open finishes: ${JSON.stringify(opened)} ${JSON.stringify(globalThis.__core9Failure)}`, opened.status === "applied");
  check("all ordered owners were published", opened.result.progress.completed.length === 10 && opened.result.progress.finished);
  check("actual immutable master source is preserved", ui.plannerRecipeSourceText === sourceText);
  check("reopen does not fabricate live media readiness", ui.getWorkspaceContributionSnapshot().pending);
  check("reopen permits an exact unchanged copy", ui.canSaveUnchangedPlannerRecipe);
  const saved = await perform("saveRecipe", { directory: crypto.randomUUID() });
  check(`actual copy workflow finishes: ${JSON.stringify(saved)}`, saved.status === "applied");
  check("copy writes exactly the opened bytes", written.length === 1 && written[0] === sourceText);
  check("copy retains source association", ui.canSaveUnchangedPlannerRecipe);
  const scan = await perform("rescanVideoLibrary", {});
  check(`catalogue publication: ${JSON.stringify(scan)} ${JSON.stringify(globalThis.__core9Failure)}`, scan.status === "applied");
  check("restored P1 verified against exact synthetic source", !ui.getWorkspaceContributionSnapshot().pending);
  await new Promise(resolve => setTimeout(resolve, 200));
  const added = await session.execute({ schema: "affect-research-planner-command", version: 1, sessionId: session.sessionId,
    requestId: crypto.randomUUID(), expectedRevision: session.revision, action: { kind: "apply", edits: [
      { kind: "operation", owner: "P2", operation: "addDemographics", arguments: {} },
    ] } });
  check(`add typed forms: ${JSON.stringify(added)}`, added.result?.updatedOwners.includes("P2")
    && added.issues.every(issue => ["unsaved_draft", "missing_language_asset"].includes(issue.code)));
  for (const language of ["en", "de"]) {
    const savedForm = await perform("saveQuestionnaire", { questionnaireId: `demographics-${language}` });
    check(`save ${language}: ${JSON.stringify(savedForm)} ${JSON.stringify(globalThis.__core9Failure)}`, savedForm.result?.published
      && savedForm.issues.every(issue => ["unsaved_draft", "missing_language_asset"].includes(issue.code)));
  }
  check("actual P2 snapshot explicitly selects typed v2", ui.getQuestionnaireRecipeContributionSnapshot().contribution?.version === 2);
  await new Promise(resolve => setTimeout(resolve, 200));
  for (const segment of ["P1", "P2", "P3", "P4", "P6"]) {
    const confirmed = await perform("confirmSegment", { segment });
    check(`confirm ${segment}: ${JSON.stringify(confirmed)} ${JSON.stringify(globalThis.__core9Failure)}`, confirmed.status === "applied");
  }
  const typedSave = await perform("saveRecipe", { directory: crypto.randomUUID() });
  check(`typed final save: ${JSON.stringify(typedSave)} ${JSON.stringify(globalThis.__core9Failure)}`, typedSave.status === "applied");
  check("actual app compiler produces master v2", JSON.parse(written.at(-1)).version === 2);
  for (const [operation, args] of [["importVideos", { paths: [crypto.randomUUID()] }], ["importVideoFolder", { directory: crypto.randomUUID() }]]) {
    const imported = await perform(operation, args);
    check(`${operation}: ${JSON.stringify(imported)}`, imported.status === "applied");
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const newFamily = await session.execute({ schema: "affect-research-planner-command", version: 1, sessionId: session.sessionId,
    requestId: crypto.randomUUID(), expectedRevision: session.revision, action: { kind: "apply", edits: [
      { kind: "operation", owner: "P2", operation: "addQuestionnaire", arguments: {
        familyId: "example-questionnaire", title: "Synthetic imported table", optionCount: 3, rowCount: 2 } },
    ] } });
  check("requested import slot created", newFamily.result?.updatedOwners.includes("P2"));
  const importedForm = await perform("importQuestionnaire", { path: crypto.randomUUID(), familyId: "example-questionnaire", language: "en" });
  check(`actual importer publication: ${JSON.stringify(importedForm)}`, importedForm.result?.published
    && importedForm.result.result.questionnaireId === template.questionnaire_id);
  const savedImport = await perform("saveQuestionnaire", { questionnaireId: template.questionnaire_id });
  check(`actual imported-source save: ${JSON.stringify(savedImport)}`, savedImport.result?.published);
  const denied = await perform("confirmSegment", { segment: "P5" });
  check("live preview cannot be separately confirmed", denied.status === "rejected");
  check("no uncaught errors", errors.length === 0);
  document.querySelector("#receipt").textContent = JSON.stringify({ passed: true, checks, errors });
})().catch(error => { document.querySelector("#receipt").textContent = JSON.stringify({ passed: false, checks, errors, error: String(error), stack: error.stack }); });
