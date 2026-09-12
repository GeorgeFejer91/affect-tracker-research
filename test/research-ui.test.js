import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ATTEMPT_DISPOSITIONS,
  INPUT_PRESET_OPTIONS,
  MAPPING_FIELDS,
  RESEARCH_MODES,
  RESEARCH_UI_EVENTS,
  SETUP_SECTIONS,
  applySetupSectionConfirmation,
  nextOpenSetupSection,
  normalizeResearchMode,
  normalizeAttemptDisposition,
  normalizeSetupSection,
  renderResearchUiMarkup,
} from "../site/src/research/app.js";
import {
  DEFAULT_COLORS,
  formatCoordinate,
  normalizePreviewState,
} from "../site/src/research/preview.js";
import {
  SETUP_ACCORDION_MOTION_MS,
  SETUP_ACCORDION_MOTION_QUERY,
} from "../site/src/research/setup-accordion-motion.js";
import {
  affectPaletteColor,
  buildFlubberPath,
  createProfiles,
  createProjectionOffsets,
} from "../site/src/math.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const expectedSections = [
  ["workspace", "Workspace & Libraries"],
  ["questionnaires", "Languages & Study Assets"],
  ["stimuli", "Experiment Plan & Stimuli"],
  ["feedback", "Flubber & Controls"],
  ["review", "Review & Start"],
];

test("the active instrument exposes exactly Setup and Run modes", () => {
  assert.deepEqual(RESEARCH_MODES, ["setup", "run"]);
  const markup = renderResearchUiMarkup("browser");
  assert.equal((markup.match(/data-mode-panel=/gu) ?? []).length, 2);
  assert.match(markup, /data-mode-panel="setup"[^>]*aria-label="Setting Up the Experiment"/u);
  assert.match(markup, /data-mode-panel="run"[^>]*aria-label="Running the Experiment"/u);
  assert.equal(normalizeResearchMode("run"), "run");
  assert.equal(normalizeResearchMode("unknown"), "setup");
});

test("Setup retains ordered review steps with one persistent P5 editor", () => {
  assert.deepEqual(SETUP_SECTIONS.map(({ id, label }) => [id, label]), expectedSections);
  const markup = renderResearchUiMarkup();
  assert.equal((markup.match(/class="setup-accordion"/gu) ?? []).length, expectedSections.length - 1);
  let cursor = -1;
  for (const [id, label] of expectedSections) {
    const next = markup.indexOf(`id="setup-trigger-${id}"`);
    assert.ok(next > cursor, `${label} must retain protocol order`);
    if (id === "feedback") {
      assert.match(markup, /data-open-section="feedback" aria-controls="preview-title"/u);
    } else {
      assert.match(markup, new RegExp(`aria-controls="setup-panel-${id}"`, "u"));
      assert.match(markup, new RegExp(`aria-labelledby="setup-trigger-${id}"`, "u"));
    }
    cursor = next;
  }
  assert.equal((markup.match(/aria-expanded="true"/gu) ?? []).length, 1);
  assert.equal(normalizeSetupSection("feedback"), "feedback");
  assert.equal(normalizeSetupSection("nope"), "workspace");
  assert.equal(nextOpenSetupSection("workspace", "review"), "review");
  assert.equal(nextOpenSetupSection("workspace", "workspace"), null);
  assert.equal(nextOpenSetupSection("review", "nope"), "workspace");
});

test("Setup accordion panels animate open and closed without weakening semantics", async () => {
  const markup = renderResearchUiMarkup();
  const [source, motionSource, css] = await Promise.all([
    read("site/src/research/app.js"),
    read("site/src/research/setup-accordion-motion.js"),
    read("site/research.css"),
  ]);

  assert.ok(Number.isFinite(SETUP_ACCORDION_MOTION_MS));
  assert.ok(SETUP_ACCORDION_MOTION_MS > 0 && SETUP_ACCORDION_MOTION_MS <= 300);
  assert.equal(SETUP_ACCORDION_MOTION_QUERY, "(prefers-reduced-motion: reduce)");
  assert.equal((markup.match(/data-motion-state="open"/gu) ?? []).length, 1);
  assert.equal((markup.match(/data-motion-state="closed"/gu) ?? []).length, expectedSections.length - 2);
  assert.equal((markup.match(/hidden inert/gu) ?? []).length, expectedSections.length - 2);
  assert.equal((markup.match(/class="setup-accordion-panel-clip"/gu) ?? []).length, expectedSections.length - 1);
  assert.equal((markup.match(/class="setup-accordion-panel-inner"/gu) ?? []).length, expectedSections.length - 1);
  assert.match(source, /import \{ setSetupAccordionPanelExpanded \} from "\.\/setup-accordion-motion\.js";/u);
  assert.match(source, /const wasOpen = trigger instanceof HTMLButtonElement/u);
  assert.match(source, /panelChanges\.push\(\[panel, isOpen\]\)[\s\S]*?focusTarget\?\.focus\(\);[\s\S]*?panelChanges\.forEach/u);
  assert.match(motionSource, /const panelTransitions = new WeakMap\(\);/u);
  assert.match(motionSource, /clearPanelTransition\(panel\);/u);
  assert.match(motionSource, /panel\.hidden = false;[\s\S]*panel\.getBoundingClientRect\(\);/u);
  assert.match(motionSource, /panel\.inert = !expanded;/u);
  assert.match(motionSource, /event\.propertyName === "grid-template-rows"/u);
  assert.match(motionSource, /window\.setTimeout\(finish, SETUP_ACCORDION_MOTION_MS \+ SETUP_ACCORDION_SETTLE_BUFFER_MS\)/u);
  assert.match(motionSource, /current\.finish !== finish/u);
  assert.match(motionSource, /if \(prefersReducedMotion\(\)\) \{\s*settlePanel\(panel, expanded\);/u);
  assert.match(css, /\.setup-accordion-panel\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-rows:\s*1fr;[\s\S]*?transition:[\s\S]*?grid-template-rows/u);
  assert.match(css, /\.setup-accordion-panel\[data-motion-state="closed"\],[\s\S]*?grid-template-rows:\s*0fr;[\s\S]*?opacity:\s*0;/u);
  assert.match(css, /\.setup-accordion-panel-clip\s*\{[\s\S]*?min-height:\s*0;/u);
  assert.match(css, /data-motion-state="closing"\] \.setup-accordion-panel-clip[\s\S]*?overflow:\s*clip;/u);
  assert.match(css, /data-motion-state="opening"\],[\s\S]*?data-motion-state="closing"\][\s\S]*?will-change:\s*grid-template-rows, opacity;/u);
});

test("every Setup section requires an explicit sequential review confirmation", async () => {
  const markup = renderResearchUiMarkup();
  const source = await read("site/src/research/app.js");
  const css = await read("site/research.css");

  assert.equal((markup.match(/class="setup-section-confirmation"/gu) ?? []).length, expectedSections.length);
  assert.equal((markup.match(/class="setup-section-confirm-button"/gu) ?? []).length, expectedSections.length);
  assert.equal((markup.match(/data-reviewed="false"/gu) ?? []).length, expectedSections.length);
  assert.equal((markup.match(/data-review-state="pending"/gu) ?? []).length, expectedSections.length);
  assert.equal((markup.match(/data-section-review-status="[^"]+"/gu) ?? []).length, expectedSections.length);
  assert.equal((markup.match(/data-section-review-check="[^"]+" aria-hidden="true" hidden>✓<\/span>/gu) ?? []).length, expectedSections.length);
  assert.equal((markup.match(/data-section-review-label="[^"]+">Not reviewed<\/span>/gu) ?? []).length, expectedSections.length);
  assert.ok(markup.includes(`>0 of ${SETUP_SECTIONS.length} reviewed · 0 ready</output>`));
  assert.match(markup, /data-confirm-section="review"[\s\S]*?>Confirm review<\/button>/u);
  for (const { id } of SETUP_SECTIONS) {
    const buttonTag = markup.match(new RegExp(`<button\\b(?=[^>]*data-confirm-section="${id}")[^>]*>`, "u"))?.[0];
    assert.ok(buttonTag, `${id} must expose its own confirmation button`);
    assert.match(buttonTag, /\btype="button"/u);
    assert.match(buttonTag, new RegExp(`aria-describedby="setup-confirmation-status-${id}"`, "u"));
    assert.match(markup, new RegExp(`data-section-review-check="${id}"`, "u"));
    assert.match(markup, new RegExp(`data-section-review-label="${id}"`, "u"));
  }

  let reviewedSectionIds = [];
  for (const [index, section] of SETUP_SECTIONS.entries()) {
    const transition = applySetupSectionConfirmation(reviewedSectionIds, section.id);
    assert.deepEqual(
      transition.reviewedSectionIds,
      SETUP_SECTIONS.slice(0, index + 1).map(({ id }) => id),
    );
    assert.equal(transition.nextSectionId, SETUP_SECTIONS[index + 1]?.id ?? null);
    const repeated = applySetupSectionConfirmation(transition.reviewedSectionIds, section.id);
    assert.deepEqual(repeated.reviewedSectionIds, transition.reviewedSectionIds);
    reviewedSectionIds = transition.reviewedSectionIds;
  }
  assert.deepEqual(
    applySetupSectionConfirmation(["feedback"], "workspace").reviewedSectionIds,
    ["workspace", "feedback"],
  );
  const jumpedToReview = applySetupSectionConfirmation([], "review");
  assert.deepEqual(jumpedToReview.reviewedSectionIds, ["review"]);
  assert.equal(jumpedToReview.nextSectionId, null);
  assert.throws(() => applySetupSectionConfirmation([], "unknown"), /Unknown Setup section confirmation/u);

  assert.match(source, /const reviewedSetupSections = new Set\(\);/u);
  assert.match(source, /checkmark\.hidden = !reviewed/u);
  assert.match(source, /reviewLabel\.textContent = reviewed \? "Reviewed" : "Not reviewed"/u);
  assert.match(source, /button\.disabled = reviewed/u);
  assert.match(source, /button\.dataset\.reviewState = reviewed \? "reviewed" : "pending"/u);
  assert.doesNotMatch(source, /Confirm again/u);
  assert.match(source, /openSetupSection\(transition\.nextSectionId, \{ focus: true \}\)/u);
  assert.match(source, /setup-trigger-\$\{sectionId\}[^\n]*\.focus\(\);\s*openSetupSection\(null\)/u);
  assert.match(source, /reviewedSetupSections\.size === SETUP_SECTIONS\.length/u);
  assert.match(source, /readySetupSectionCount = readySections;\s*renderSetupReviewState\(\);/u);
  const preflightStart = source.indexOf("function preflightItems()");
  const preflightEnd = source.indexOf("function renderPreflight()", preflightStart);
  assert.ok(preflightStart >= 0 && preflightEnd > preflightStart);
  assert.doesNotMatch(source.slice(preflightStart, preflightEnd), /reviewedSetupSections/u);
  const requestStartStart = source.indexOf("function requestStart()");
  const requestStartEnd = source.indexOf('root.addEventListener("click"', requestStartStart);
  assert.ok(requestStartStart >= 0 && requestStartEnd > requestStartStart);
  assert.doesNotMatch(source.slice(requestStartStart, requestStartEnd), /reviewedSetupSections/u);
  const workspaceReadyStart = source.indexOf("root.addEventListener(RESEARCH_UI_EVENTS.workspaceReady");
  const workspaceReadyEnd = source.indexOf('root.querySelectorAll("[data-open-section]")', workspaceReadyStart);
  assert.ok(workspaceReadyStart >= 0 && workspaceReadyEnd > workspaceReadyStart);
  assert.doesNotMatch(source.slice(workspaceReadyStart, workspaceReadyEnd), /reviewedSetupSections\.(?:add|clear|delete)/u);
  const openSectionStart = source.indexOf("function openSetupSection(");
  const openSectionEnd = source.indexOf("function confirmSetupSection(", openSectionStart);
  assert.doesNotMatch(source.slice(openSectionStart, openSectionEnd), /reviewedSetupSections/u);

  assert.match(css, /\.setup-section-confirmation\s*\{[\s\S]*?justify-content:\s*flex-end;/u);
  assert.match(css, /\.section-review-status\s*\{[\s\S]*?color:\s*var\(--success\);/u);
  assert.match(css, /\.section-review-status \[data-section-review-check\]:not\(\[hidden\]\)\s*\{[\s\S]*?border:\s*1px solid currentcolor;[\s\S]*?border-radius:\s*50%;[\s\S]*?background:\s*rgb\(117 189 143 \/ 12%\);/u);
  assert.match(css, /\.setup-accordion-panel\[data-motion-state="open"\] \.setup-section-confirm-button\[data-review-state="pending"\]::after,[\s\S]*?animation:\s*setup-confirm-attention/u);
  const reviewedStyleStart = css.indexOf('.setup-section-confirm-button[data-review-state="reviewed"]');
  const reviewedStyleEnd = css.indexOf("}", reviewedStyleStart);
  assert.ok(reviewedStyleStart >= 0 && reviewedStyleEnd > reviewedStyleStart);
  assert.doesNotMatch(css.slice(reviewedStyleStart, reviewedStyleEnd), /animation/u);
  assert.match(css, /@keyframes setup-confirm-attention[\s\S]*?filter:\s*blur\(1px\);[\s\S]*?opacity:\s*1;[\s\S]*?filter:\s*blur\(4px\);[\s\S]*?opacity:\s*0\.38;/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.setup-accordion-panel\[data-motion-state="open"\][\s\S]*?animation:\s*none !important;[\s\S]*?filter:\s*blur\(4px\);/u);
  const reviewPanelStart = markup.indexOf('id="setup-panel-review"');
  const reviewPanelEnd = markup.indexOf('<aside class="preview-pane"', reviewPanelStart);
  const reviewPanel = markup.slice(reviewPanelStart, reviewPanelEnd);
  assert.ok(reviewPanel.indexOf('data-confirm-section="review"') > reviewPanel.indexOf('class="start-bar"'));
});

test("every browser and desktop review step ends with one confirmation footer", () => {
  for (const surface of ["browser", "tauri"]) {
    const markup = renderResearchUiMarkup(surface);
    for (const { id } of SETUP_SECTIONS) {
      const start = markup.indexOf(id === "feedback" ? '<aside class="preview-pane"' : `id="setup-panel-${id}"`);
      const footer = markup.indexOf('class="setup-section-confirmation"', start);
      const end = markup.indexOf(id === "feedback" ? '</aside>' : '</div></div></div>\n    </section>', footer);
      assert.ok(start >= 0 && footer > start && end > footer, `${surface}/${id}: footer exists`);
      const panel = markup.slice(start, end);
      assert.equal((panel.match(/data-confirm-section=/gu) ?? []).length, 1);
      assert.match(panel, new RegExp(`data-confirm-section="${id}"`, "u"));
      assert.match(panel, id === "feedback"
        ? /<\/button>\s*<\/div>\s*<\/div>\s*<\/div>\s*$/u
        : /<\/button>\s*<\/div>\s*$/u, `${surface}/${id}: confirmation ends panel`);
    }
  }
});

test("pending confirmation has a stronger layered breathing edge with accessible fallbacks", async () => {
  const css = await read("site/research.css");
  const glow = css.slice(css.indexOf('.setup-accordion-panel[data-motion-state="open"] .setup-section-confirm-button'), css.indexOf('.setup-section-confirm-button[data-review-state="reviewed"]'));
  assert.match(glow, /border: 2px solid rgb\(240 197 105 \/ 95%\)/u);
  assert.match(glow, /box-shadow: 0 0 7px 2px rgb\(240 197 105 \/ 48%\), 0 0 18px 5px rgb\(240 197 105 \/ 20%\)/u);
  assert.match(glow, /animation: setup-confirm-attention 2\.2s ease-in-out infinite/u);
  assert.match(glow, /pointer-events: none/u);
  const keyframes = css.slice(css.indexOf("@keyframes setup-confirm-attention"), css.indexOf(".section-lead,"));
  assert.doesNotMatch(keyframes, /inset:|transform:/u, "breathing must not move the button edge");
  assert.match(css.slice(css.indexOf("@media (forced-colors: active)")), /border-color: Highlight;\s*animation: none;\s*box-shadow: none;/u);
});

test("Section 2 uses multilingual questionnaire tables and hides backend documents", async () => {
  const source = await read("site/src/research/app.js");
  const editor = await read("site/src/research/questionnaire-editor.js");
  const markup = renderResearchUiMarkup();
  const sectionStart = markup.indexOf('id="setup-panel-questionnaires"');
  const sectionEnd = markup.indexOf('data-setup-section="stimuli"', sectionStart);
  const section = markup.slice(sectionStart, sectionEnd);
  for (const id of [
    "study-language-add", "study-language-add-button", "study-language-list",
    "questionnaire-add-blank", "questionnaire-sheet-list", "questionnaire-sheet-file",
    "questionnaire-sheet-preview", "questionnaire-coverage-status",
  ]) assert.ok(section.includes(`id="${id}"`), id);
  for (const id of ["questionnaire-prebuilt-open", "questionnaire-prebuilt-dialog", "questionnaire-prebuilt-list", "questionnaire-sheet-copy"]) assert.ok(section.includes(`id="${id}"`));
  assert.doesNotMatch(section, /data-questionnaire-preset/u);
  for (const retired of ["questionnaire-file-input", "questionnaire-preview-dialog", "questionnaire-inspiration-dialog", "questionnaire-definition-list", "questionnaire-module-list"]) {
    assert.ok(!markup.includes(`id="${retired}"`), `Retired questionnaire surface: ${retired}`);
  }
  assert.doesNotMatch(section, /phencon|inspiration|questionnaire-module-list|protocol-plan-hash|JSON|sourceSha256/u);
  assert.match(section, /Paste items, answer labels and recorded values together from Excel/u);
  assert.match(section, /before the video task/u);
  assert.match(editor, /event\.clipboardData\.getData\("text\/plain"\)/u);
  assert.doesNotMatch(editor, /navigator\.clipboard|document\.execCommand/u);
  assert.match(editor, /data-sheet-cell/u);
  assert.match(editor, /data-sheet-repeat/u);
  assert.match(editor, /data-sheet-required/u);
  assert.match(source, /questionnaireEditor\.pendingKeys\(\)/u);
  assert.match(source, /requestQuestionnaireAssetStorage\(root, payload\)/u);
  assert.match(source, /createCoveredFlatLanguageSelectionV1/u);
  assert.doesNotMatch(source, /questionnaires\/tas-20-en\.csv/u);
  assert.equal((markup.match(/data-mode-panel=/gu) ?? []).length, 2);
});

test("Workspace exposes one selected root and three fixed project locations", async () => {
  const source = await read("site/src/research/app.js");
  const markup = renderResearchUiMarkup();
  const workspacePanelStart = markup.indexOf('id="setup-panel-workspace"');
  const workspacePanelEnd = markup.indexOf('data-setup-section="questionnaires"', workspacePanelStart);
  assert.ok(workspacePanelStart >= 0 && workspacePanelEnd > workspacePanelStart, "the workspace accordion panel must be independently inspectable");
  const workspacePanel = markup.slice(workspacePanelStart, workspacePanelEnd);

  assert.deepEqual(
    [...workspacePanel.matchAll(/data-workspace-location="([^"]+)"/gu)].map((match) => match[1]),
    ["workspaceRoot", "videoLibrary", "experimentPackage"],
    "the three project locations must retain their task order",
  );
  assert.equal((workspacePanel.match(/id="workspace-choose"/gu) ?? []).length, 1);
  assert.match(workspacePanel, /<button id="workspace-choose"[^>]*>Set work directory<\/button>/u);

  const openLocationButtons = [...workspacePanel.matchAll(/<button\b[^>]*data-open-workspace-location="([^"]+)"[^>]*>/gu)];
  assert.equal(openLocationButtons.length, 3);
  assert.deepEqual(openLocationButtons.map((match) => match[1]), ["workspaceRoot", "videoLibrary", "experimentPackage"]);
  for (const [button] of openLocationButtons) {
    assert.match(button, /\btype="button"/u);
    assert.match(button, /\baria-label="[^"]+"/u);
    assert.match(button, /\sdisabled(?:\s|>)/u, "location buttons remain unavailable until the root is ready");
  }

  assert.match(workspacePanel, /<code>assets\/stimuli\/<\/code>/u);
  assert.match(workspacePanel, /<code>experiment\.package\.json<\/code>/u);
  assert.match(workspacePanel, /Videos, project JSON, outputs, and recovery stay inside it/u);
  assert.match(workspacePanel, /id="workspace-status"[^>]*><\/p>/u);
  for (const id of ["experiment-id", "experiment-title"]) {
    assert.equal((workspacePanel.match(new RegExp(`id="${id}"`, "gu")) ?? []).length, 1);
    assert.match(workspacePanel, new RegExp(`id="${id}"[^>]*readonly`, "u"));
  }
  assert.doesNotMatch(markup, /id="setup-panel-experiment"/u);
  for (const obsoleteWorkspaceStructure of [
    /class="[^"]*\bdirectory-list\b/u,
    /class="[^"]*\bprotocol-import-card\b/u,
    /id="settings-load"/u,
    /id="settings-save"/u,
  ]) assert.doesNotMatch(workspacePanel, obsoleteWorkspaceStructure);
  for (const id of ["video-drop-zone", "stimulus-library-table", "video-import", "video-folder-import", "workspace-rescan"]) {
    assert.equal((workspacePanel.match(new RegExp(`id="${id}"`, "gu")) ?? []).length, 1);
    assert.equal((markup.match(new RegExp(`id="${id}"`, "gu")) ?? []).length, 1);
  }
  assert.doesNotMatch(workspacePanel, /data-open-section="stimuli"[^>]*>Manage videos</u);
  const stimuliPanelStart = markup.indexOf('id="setup-panel-stimuli"');
  const stimuliPanelEnd = markup.indexOf('data-setup-section="experiment"', stimuliPanelStart);
  const stimuliPanel = markup.slice(stimuliPanelStart, stimuliPanelEnd);
  assert.doesNotMatch(stimuliPanel, /id="(?:video-drop-zone|stimulus-library-table|video-import|video-folder-import|workspace-rescan)"/u);

  for (const id of ["workspace-choose", "workspace-rescan", "video-import", "video-folder-import", "package-load", "package-generate", "package-file-status", "experiment-load", "experiment-template-download", "experiment-file-status", "settings-load", "settings-save"]) {
    assert.match(markup, new RegExp(`id="${id}"`, "u"));
  }
  for (const id of [
    "package-reproduction-status",
    "choose-participant-language", "participant-language-dialog",
    "participant-language-context", "participant-language-breadcrumb",
    "participant-language-prompt", "participant-language-options",
    "participant-language-back", "participant-language-cancel",
  ]) {
    assert.match(markup, new RegExp(`id="${id}"`, "u"));
  }
  assert.doesNotMatch(markup, /id="package-language-tree"/u);
  assert.doesNotMatch(markup, /id="package-language-route"/u);
  assert.doesNotMatch(markup, /id="package-file-input"/u);
  assert.match(source, /workspace\.loadExperimentPackage\(\)/u);
  assert.match(source, /workspace\.saveExperimentPackage\(sourceText\)/u);
  assert.match(source, /workspace\.attestExperimentPackageRoot/u);
  assert.match(source, /const catalogue = await workspace\.rescanPackageVideos\(\)/u);
  assert.match(source, /const importedPaths = await workspace\.importVideoFiles\(files\)[\s\S]*?const relativePath = `stimuli\/\$\{importedPaths\[index\]\}`/u);
  assert.match(source, /if \(target\.id === "video-import"\) requestVideoImport\(\)/u);
  assert.match(source, /if \(target\.id === "video-folder-import"\) requestVideoImport\(\{ directory: true \}\)/u);
  assert.match(source, /const dropZone = query\("#video-drop-zone"\)/u);
  assert.match(source, /const canOpen = surface === "tauri" && capabilities\.directoryPermission/u);
  assert.match(source, /root\.addEventListener\(RESEARCH_UI_EVENTS\.workspaceReady,[\s\S]*?refreshWorkspaceLocationButtons\(\);/u);
  assert.match(source, /directoryPermission \? "ready" : "warning"/u);
  assert.match(source, /Work directory access is unavailable\. Restore access or select it again\./u);
  assert.match(markup, /Package reproduction matrix/u);
  assert.match(source, /loadedLanguageSelection = structuredClone\(parsed\.package\.languageSelection\)/u);
  assert.match(source, /const flat = createCoveredFlatLanguageSelectionV1/u);
  assert.match(source, /reconcileQuestionnaireModuleMappings\(loadedLanguageSelection/u);
  assert.match(source, /resolveLanguageSelectionTraversalStepV1/u);
  assert.match(source, /validateExperimentPackageRecoveryBindingV1/u);
  assert.match(source, /participantRecoveryBindings/u);
  assert.match(source, /No language was selected/u);
  assert.doesNotMatch(source, /routes\[0\]/u);
  assert.doesNotMatch(source, /questionnaireModuleIds = questionnaireModules\.filter/u);
  assert.match(markup, /Folders are scanned recursively/u);
  assert.match(markup, /Prepare randomization outside Affect Research/u);
  assert.match(markup, /supplies every participant’s block order, complete-video order, and the ISI after each video/u);
  assert.match(markup, /Array order is authoritative/u);
  assert.match(markup, /id="sampling-frequency"[^>]*min="1"[^>]*max="240"[^>]*value="130"/u);
  for (const id of ["experiment-id", "experiment-title", "participant-count"]) {
    assert.match(markup, new RegExp(`id="${id}"[^>]*readonly`, "u"));
  }
  assert.match(markup, /Continuous rating is always enabled/u);
  assert.doesNotMatch(markup, /id="(?:continuous-rating|single-summary-rating)"/u);
  assert.match(markup, /external-order-v1/u);
  assert.match(markup, /<code>schedules\[\]\.blocks\[\]\.videos\[\]<\/code> is executed exactly in array order/u);
  assert.match(markup, /isiAfterMs/u);
  assert.match(markup, /Export resolved-plan\.csv/u);
  assert.doesNotMatch(markup, /Williams counterbalancing|Cyclic rotation|balanced-v1|name="transitionMode"/u);
});

test("Workspace offers an accessible local stimulus inspiration catalogue before video import", async () => {
  const source = await read("site/src/research/app.js");
  const markup = renderResearchUiMarkup();
  assert.ok(markup.indexOf('id="stimulus-inspiration-open"') < markup.indexOf('id="video-import"'));
  assert.match(markup, /id="stimulus-inspiration-open"[^>]*class="inspiration-action pictographic-action"[^>]*aria-label="Stimulus inspiration"[^>]*title="Stimulus inspiration"[^>]*aria-haspopup="dialog"[^>]*aria-controls="stimulus-inspiration-dialog"/u);
  assert.match(markup, /<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">[\s\S]*class="inspiration-spark"/u);
  assert.match(markup, /<dialog id="stimulus-inspiration-dialog"[^>]*aria-labelledby="stimulus-inspiration-title"[^>]*aria-describedby=/u);
  for (const category of ["Video", "Audio", "Vignette"]) {
    assert.match(markup, new RegExp(`>${category}<\\/h3>`, "u"));
  }
  for (const sourceName of ["CAAV", "OpenLAV", "Emo-FilM / LIRIS-ACCEDE", "CASE", "DEAM", "Emo-Soundscapes", "IDEST", "SENDv1"]) {
    assert.match(markup, new RegExp(`>${sourceName.replaceAll("/", "\\/")}<`, "u"));
  }
  assert.equal((markup.match(/DOI: /gu) ?? []).length, 8);
  assert.equal((markup.match(/>Official source/gu) ?? []).length, 8);
  assert.match(markup, /nothing is downloaded or added to this experiment/u);
  assert.match(markup, /induced or felt valence–arousal is the closest validation target/u);
  assert.match(markup, /Perceived or expressed emotion is complementary, not equivalent/u);
  assert.match(markup, /revalidate anything edited, concatenated, translated, narrated, or synthesized/u);
  assert.match(markup, /<form method="dialog" class="dialog-actions">/u);
  assert.match(source, /target\.id === "stimulus-inspiration-open"[\s\S]*dialog\.showModal\(\)/u);
  assert.equal((markup.match(/data-mode-panel=/gu) ?? []).length, 2);
});

test("participant language is explicit per attempt and recovery cannot reroute it", async () => {
  const source = await read("site/src/research/app.js");
  const markup = renderResearchUiMarkup();
  assert.match(markup, /<dialog id="participant-language-dialog"[^>]*aria-labelledby="participant-language-title"/u);
  assert.match(markup, /<fieldset class="participant-language-fieldset">/u);
  assert.match(markup, /id="participant-language-error"[^>]*role="alert"/u);
  assert.match(source, /function openParticipantLanguageDialog\(\)[\s\S]*selectedAttemptDisposition\(\) === "resume-compatible"[\s\S]*cannot be rerouted/u);
  assert.match(source, /dataset\.languageOption = option\.optionId/u);
  assert.match(source, /function validateRecoveryLanguageBinding\(binding\)[\s\S]*canonicalSourceByteSha256[\s\S]*packageDefinitionSha256[\s\S]*stale or invalid language route/u);
  assert.match(source, /compiled\.assignmentSha256 !== expectedRecoveryBinding\.assignmentSha256/u);
  assert.match(source, /RESEARCH_UI_EVENTS\.runStarted[\s\S]*clearParticipantLanguageSelection\(\)[\s\S]*setMode\("run"\)/u);
  assert.match(source, /RESEARCH_UI_EVENTS\.startRejected[\s\S]*clearParticipantLanguageSelection\(\)[\s\S]*schedulePlanRefresh\(\)/u);
  assert.match(source, /participant-language-cancel[\s\S]*clearParticipantLanguageSelection\(\)[\s\S]*Start remains blocked/u);
  assert.doesNotMatch(source, /routes\[0\]|package-language-route/u);
});

test("all nine input presets, custom capture, conflict guidance, and live test are exposed", () => {
  assert.deepEqual(INPUT_PRESET_OPTIONS.map(({ label }) => label), [
    "Arrow keys",
    "WASD",
    "IJKL",
    "Numeric keypad",
    "Pointer / trackpad grid",
    "Mouse buttons and wheel",
    "Gamepad D-pad",
    "Gamepad left stick",
    "Gamepad right stick",
  ]);
  const markup = renderResearchUiMarkup();
  for (const { id, label } of INPUT_PRESET_OPTIONS) {
    assert.match(markup, new RegExp(`<option value="${id}">${label.replace("/", "\\/")}</option>`, "u"));
  }
  assert.match(markup, /id="input-step-size"[^>]*value="0\.1"/u);
  assert.match(markup, /Digital input moves once per physical press/u);
  assert.match(markup, /ignores operating-system repeat/u);
  assert.match(markup, /captured action cannot be assigned twice/u);
  assert.match(markup, /id="binding-capture-dialog"/u);
  assert.match(markup, /id="input-test"/u);
});

test("visual feedback has independent Grid and Flubber controls and one color owner", () => {
  const markup = renderResearchUiMarkup();
  for (const id of [
    "visual-grid-visible", "visual-flubber-visible", "visual-size", "visual-transparency",
    "visual-hide-feedback", "visual-lock-position", "visual-position-x", "visual-position-y",
    "flubber-outline-visible", "flubber-outline-thickness", "flubber-halo-visible",
    "grid-line-thickness", "grid-outline-visible", "grid-outline-thickness", "grid-cursor-size",
  ]) assert.match(markup, new RegExp(`id="${id}"`, "u"));
  assert.match(markup, /id="visual-size" type="number"/u);
  assert.equal((markup.match(/id="color-halo"/gu) ?? []).length, 1);
  assert.equal((markup.match(/id="color-halo-hex"/gu) ?? []).length, 1);
  assert.doesNotMatch(markup, /id="flubber-halo-color"/u);
  for (const anchor of ["up", "down", "left", "right", "idle", "outline", "halo", "cursor"]) {
    assert.match(markup, new RegExp(`id="color-${anchor}"`, "u"));
    assert.match(markup, new RegExp(`id="color-${anchor}-hex"`, "u"));
    if (["up", "down", "left", "right"].includes(anchor)) {
      assert.match(markup, new RegExp(`id="color-${anchor}-hex" type="hidden"`, "u"));
      assert.doesNotMatch(markup, new RegExp(`data-color-reset="${anchor}"`, "u"));
    } else {
      assert.match(markup, new RegExp(`data-color-reset="${anchor}"`, "u"));
    }
  }
  assert.match(markup, /id="main-gradient-canvas"/u);
  assert.equal((markup.match(/data-color-anchor=/gu) ?? []).length, 4);
  assert.match(markup, /Acquisition continues while Grid and Flubber are hidden/u);
  assert.match(markup, /sole control for disabling drag/u);
});

test("Advanced contains the exact LSL fields and six mapping disclosures", () => {
  const markup = renderResearchUiMarkup();
  for (const id of ["lsl-enabled", "lsl-state-stream", "lsl-stream-type", "lsl-marker-stream", "lsl-source-id"]) {
    assert.match(markup, new RegExp(`id="${id}"`, "u"));
  }
  assert.deepEqual(MAPPING_FIELDS.map(({ label, allowedMin, allowedMax, min, max, driver, reverse }) => ({
    label, allowedMin, allowedMax, min, max, driver, reverse,
  })), [
    { label: "Oscillation Frequency", allowedMin: 0, allowedMax: 10, min: 0.5, max: 2.5, driver: "y-axis", reverse: false },
    { label: "Edge Smoothness", allowedMin: 0, allowedMax: 1, min: 0, max: 1, driver: "x-axis", reverse: false },
    { label: "Projection Amplitude", allowedMin: 0, allowedMax: 1, min: 0.2, max: 0.4, driver: "y-axis", reverse: false },
    { label: "Pulse Synchrony", allowedMin: 0, allowedMax: 1, min: 0.2, max: 1, driver: "x-axis", reverse: false },
    { label: "Wave-size Variation", allowedMin: 0, allowedMax: 1, min: 0, max: 0.8, driver: "x-axis", reverse: true },
    { label: "Saturation", allowedMin: 0, allowedMax: 1, min: 0, max: 1, driver: "radius", reverse: false },
  ]);
  assert.equal((markup.match(/class="inner-disclosure mapping-disclosure"/gu) ?? []).length, 6);
  for (const driver of ["x-axis", "y-axis", "angle", "radius"]) assert.match(markup, new RegExp(`<option value="${driver}"`, "u"));
});

test("Review and Start carries privacy, participant-state, format, and fail-closed controls", () => {
  const markup = renderResearchUiMarkup();
  assert.match(markup, /Availability and recovery/u);
  assert.match(markup, /Availability and recovery are read from saved attempts/u);
  for (const id of ["participant-first-name", "participant-last-name", "participant-age", "participant-gender", "participant-handedness", "participant-code"]) {
    assert.match(markup, new RegExp(`id="${id}"`, "u"));
  }
  assert.match(markup, /id="participant-count"[^>]*max="100000"/u);
  assert.match(markup, /id="participant-window-previous"/u);
  assert.match(markup, /id="participant-window-next"/u);
  assert.deepEqual(ATTEMPT_DISPOSITIONS, ["resume-compatible", "new-attempt"]);
  for (const disposition of ATTEMPT_DISPOSITIONS) assert.match(markup, new RegExp(`name="attemptDisposition" value="${disposition}"`, "u"));
  assert.match(markup, /id="participant-rerun-confirm"/u);
  assert.match(markup, /Resume compatible partial/u);
  assert.match(markup, /Start a new attempt/u);
  assert.equal(normalizeAttemptDisposition("partial", "resume-compatible"), "resume-compatible");
  assert.equal(normalizeAttemptDisposition("partial", "new-attempt"), "new-attempt");
  assert.equal(normalizeAttemptDisposition("complete", "resume-compatible"), "new-attempt");
  assert.equal(normalizeAttemptDisposition("available", "resume-compatible"), "new-attempt");
  for (const option of ["Woman", "Man", "Non-binary", "Self-described", "Prefer not to say", "Left", "Right", "Ambidextrous"]) {
    assert.match(markup, new RegExp(`>${option}<`, "u"));
  }
  assert.match(markup, /Raw names[^<]*removed before Start/u);
  assert.match(markup, /id="output-csv"[^>]*checked/u);
  assert.match(markup, /id="output-tsv"/u);
  assert.match(markup, /id="start-experiment"[^>]*disabled/u);
  for (const id of ["settings-hash", "review-plan-hash", "storage-estimate", "timing-capability", "native-playback-mode", "native-media-capability", "lsl-capability"]) {
    assert.match(markup, new RegExp(`id="${id}"`, "u"));
  }
  assert.match(markup, /GStreamer \/ GstPlay · qualification required/u);
  assert.match(markup, /WebView video · unqualified testing only/u);
});

test("Run has mutually exclusive questionnaire and stimulus stages with bounded controls", () => {
  const markup = renderResearchUiMarkup();
  const run = markup.slice(markup.indexOf('<section class="run-mode"'), markup.indexOf("</main>"));
  assert.ok(run.indexOf('class="stimulus-stage"') < run.indexOf('class="run-feedback-stage"'));
  for (const id of ["run-native-video-host", "run-video", "run-pause", "run-stop-early", "run-stimulus-status", "run-timing-status", "run-write-status", "run-lsl-status", "run-transition", "run-continue", "run-questionnaire-stage", "run-questionnaire-form", "run-questionnaire-previous", "run-questionnaire-next", "run-questionnaire-submit"]) {
    assert.match(run, new RegExp(`id="${id}"`, "u"));
  }
  assert.match(run, /id="run-pause"[^>]*hidden disabled/u,
    "Pause is unavailable until the authoritative runtime reports an active video");
  for (const setupOnly of ["experiment-id", "participant-count", "input-preset", "visual-size", "lsl-enabled", "start-experiment"]) {
    assert.doesNotMatch(run, new RegExp(`id="${setupOnly}"`, "u"));
  }
  assert.match(run, /Configured adjacent visual feedback/u);
  assert.match(run, /preflighted complete video/u);
  assert.match(run, /Sampling is stopped and the rating is neutral/u);
  assert.match(markup, /controlled stop finalizes an explicitly partial result and cannot be resumed/u);
});

test("Run input routing is enabled only by authoritative active-stimulus status", async () => {
  const source = await read("site/src/research/app.js");
  assert.match(source, /typeof detail\.ratingInputActive === "boolean"\) ratingInputEnabled = detail\.ratingInputActive/u);
  assert.match(source, /mode === "run" && ratingInputEnabled && !activeQuestionnaire/u,
    "questionnaire arrow-key navigation must not be routed into affect bindings");
  assert.match(source, /pause\.hidden = !detail\.pauseAvailable/u);
  assert.match(source, /pause\.disabled = !detail\.pauseAvailable/u);
});

test("external experiment plan export uses the canonical source-identity and ISI serializer", async () => {
  const [source, view] = await Promise.all([
    read("site/src/research/app.js"),
    read("site/src/research/ui-view.js"),
  ]);
  assert.match(source, /import \{ externalExperimentPlanToCsv \} from "\.\/tabular\.js"/u);
  assert.match(source, /csv = await externalExperimentPlanToCsv\(plan\)/u);
  assert.match(view, /resolved-plan\.csv/u);
  assert.doesNotMatch(source, /assignmentPlanToCsv\(plan\)/u);
});

test("the UI bridge names are explicit and stable", () => {
  assert.deepEqual(RESEARCH_UI_EVENTS, {
    selectWorkspaceRequest: "affect-research:select-workspace",
    openWorkspaceLocationRequest: "affect-research:open-workspace-location",
    rescanWorkspaceRequest: "affect-research:rescan-workspace",
    importVideosRequest: "affect-research:import-videos-request",
    loadSettingsRequest: "affect-research:load-settings-request",
    loadExperimentRequest: "affect-research:load-experiment-request",
    loadExperimentPackageRequest: "affect-research:load-experiment-package-request",
    saveExperimentPackageRequest: "affect-research:save-experiment-package-request",
    saveSettingsRequest: "affect-research:save-settings-request",
    exportPlanRequest: "affect-research:export-plan-request",
    importQuestionnaireRequest: "affect-research:import-questionnaire-request",
    storeQuestionnaireAssetRequest: "affect-research:store-questionnaire-asset-request",
    questionnaireDraftRequest: "affect-research:questionnaire-draft-request",
    questionnaireSubmitRequest: "affect-research:questionnaire-submit-request",
    planReady: "affect-research:plan-ready",
    setupSettingsReady: "affect-research:setup-settings-ready",
    inputTestState: "affect-research:input-test-state",
    inputEdge: "affect-research:input-edge",
    inputBindingChanged: "affect-research:input-binding-changed",
    inputTestReset: "affect-research:input-test-reset",
    inputCaptureRequest: "affect-research:input-capture-request",
    inputCaptureCancel: "affect-research:input-capture-cancel",
    startRequest: "affect-research:start-request",
    startRejected: "affect-research:start-rejected",
    pauseRequest: "affect-research:pause-request",
    stopEarlyRequest: "affect-research:stop-early-request",
    continueRequest: "affect-research:continue-request",
    settingsLoaded: "affect-research:settings-loaded",
    experimentLoaded: "affect-research:experiment-loaded",
    experimentPackageLoaded: "affect-research:experiment-package-loaded",
    capabilityStatus: "affect-research:capability-status",
    workspaceReady: "affect-research:workspace-ready",
    stimuliCatalogued: "affect-research:stimuli-catalogued",
    participantStates: "affect-research:participant-states",
    runStarted: "affect-research:run-started",
    runStatus: "affect-research:run-status",
    questionnaireStatus: "affect-research:questionnaire-status",
    runComplete: "affect-research:run-complete",
  });
});

test("Start emits an explicit attempt disposition without raw participant names", async () => {
  const source = await read("site/src/research/app.js");
  assert.match(source, /attemptDisposition,/u);
  assert.match(source, /rerunConfirmed,/u);
  assert.match(source, /setInputValue\("participant-first-name", ""\)/u);
  assert.match(source, /setInputValue\("participant-last-name", ""\)/u);
  const detailBlock = source.slice(source.indexOf("const detail = {"), source.indexOf("const event = new CustomEvent", source.indexOf("const detail = {")));
  for (const field of [
    "experimentPackageSourceText",
    "experimentPackageSourceByteSha256",
    "experimentPackageDefinitionSha256",
    "experimentPackageId",
    "selectedLanguageId",
    "languageSelectionPath",
    "packageAssignmentSha256",
    "packageAssetBindings",
  ]) {
    assert.match(detailBlock, new RegExp(`${field}:?`, "u"));
  }
  assert.doesNotMatch(detailBlock, /firstName|lastName/u);
});

test("pending native finalization has an explicit acquisition-free Setup dispatch", async () => {
  const source = await read("site/src/research/app.js");
  assert.match(source, /__finalizationPending/u);
  assert.match(source, /__finalizationBinding/u);
  assert.match(source, /function selectedPendingFinalization\(\)[\s\S]*protocolContract = experimentPackageDocument[\s\S]*\? "manifestV4"[\s\S]*\? "manifestV3"[\s\S]*: "manifestV2"[\s\S]*expectedSettingsSha256 = protocolContract === "manifestV2" \? settingsHash : protocolSettingsHash[\s\S]*binding\.protocolContract !== protocolContract[\s\S]*binding\.settingsSha256 !== expectedSettingsSha256[\s\S]*binding\.assignmentPlanSha256 !== plan\.planHashSha256/u);
  assert.match(source, /Finalize pending \$\{pendingFinalization\.completionStatus\} attempt/u);
  const requestStart = source.slice(
    source.indexOf("function requestStart()"),
    source.indexOf("root.addEventListener(\"click\"", source.indexOf("function requestStart()")),
  );
  const recoveryBranch = requestStart.slice(0, requestStart.indexOf("const fieldsValid"));
  assert.match(recoveryBranch, /recoveryFinalizationOnly: true/u);
  assert.match(recoveryBranch, /pendingFinalizationAttemptNumber: pendingFinalization\.attemptNumber/u);
  assert.match(recoveryBranch, /pendingFinalizationCompletionStatus: pendingFinalization\.completionStatus/u);
  assert.match(recoveryBranch, /participantId: selectedParticipant/u);
  assert.match(recoveryBranch, /settingsSha256: settingsHash/u);
  assert.doesNotMatch(recoveryBranch, /deriveParticipantRecord|inputTestReceiptId|verifiedStimulusIds|storageReady|timingWorkerReady/u);
});

test("manifest readiness is fail-closed and the adapter exposes authoritative neutral reset", async () => {
  const source = await read("site/src/research/app.js");
  assert.match(source, /manifestReady: false/u);
  assert.match(source, /capabilities\.manifestReady \? "pass" : "block"/u);
  assert.match(source, /manifestReady: capabilities\.manifestReady/u);
  assert.match(source, /resetAffect\(reason = "safe-boundary"\)/u);
  assert.match(source, /inputController\.resetNeutral\(reason\)/u);
  assert.match(source, /representative WebView frames attested \(unqualified playback\)/u);
  assert.match(source, /installed-hardware qualification pending/u);
  assert.equal((source.match(/new CustomEvent\(RESEARCH_UI_EVENTS\.workspaceReady/gu) ?? []).length, 2, "selection and permission renewal both request a manifest rescan");
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) {
    assert.match(source, new RegExp(`runFeedbackStage\\?\\.addEventListener\\("${event}", handleRunPointer\\)`, "u"));
  }
});

test("preview normalization is bounded, deterministic, and uses Research defaults", () => {
  assert.deepEqual(DEFAULT_COLORS, {
    up: "#f2c94c", down: "#2f80ed", left: "#eb5757", right: "#27ae60",
    idle: "#9ca3af", outline: "#f8fafc", halo: "#93c5fd", cursor: "#ffffff",
  });
  const state = normalizePreviewState({
    x: 4,
    y: -4,
    sizePercent: 999,
    transparencyPercent: -2,
    position: { x: -1, y: 2 },
    flubber: { outlineThickness: 99 },
    grid: { lineThickness: 0, outlineThickness: 99, cursorSize: 0 },
    colors: { halo: "invalid" },
  });
  assert.equal(state.x, 1);
  assert.equal(state.y, -1);
  assert.equal(state.sizePercent, 100);
  assert.equal(state.transparencyPercent, 0);
  assert.deepEqual(state.position, { x: 0, y: 1 });
  assert.equal(state.flubber.outlineThickness, 20);
  assert.equal(state.grid.lineThickness, 0.25);
  assert.equal(state.grid.outlineThickness, 20);
  assert.equal(state.grid.cursorSize, 2);
  assert.equal(state.colors.halo, DEFAULT_COLORS.halo);
  assert.equal(formatCoordinate(0), "+0.000");
  assert.equal(formatCoordinate(-2), "-1.000");
});

test("all six Flubber mapping outputs materially control the renderer", () => {
  const profiles = createProfiles(64, 8);
  const offsets = createProjectionOffsets("research-renderer-contract", 8);
  const render = (overrides = {}) => buildFlubberPath({
    profiles,
    offsets,
    x: 0.6,
    y: 0.4,
    phase: 1.25,
    palette: DEFAULT_COLORS,
    projectionAmplitude: 0.3,
    edgeSmoothness: 0.5,
    pulseSynchrony: 0.6,
    amplitudeVariation: 0.4,
    colorSaturation: 0.5,
    ...overrides,
  });
  const baseline = render();
  assert.notEqual(render({ projectionAmplitude: 0.8 }).path, baseline.path);
  assert.notEqual(render({ edgeSmoothness: 0 }).path, baseline.path);
  assert.notEqual(render({ pulseSynchrony: 1 }).path, baseline.path);
  assert.notEqual(render({ amplitudeVariation: 0 }).path, baseline.path);
  assert.notEqual(render({ colorSaturation: 1 }).color, baseline.color);
  assert.notEqual(render({ phase: 1.75 }).path, baseline.path);
  assert.equal(affectPaletteColor(1, 0, DEFAULT_COLORS, 0), "rgb(183 183 183)");
});

test("programmatic binding, color, and overlay changes invalidate the frozen protocol", async () => {
  const source = await read("site/src/research/app.js");
  assert.match(source, /onPositionChange\(position\)[\s\S]*?refreshProjection\(\);\s*schedulePlanRefresh\(\);/u);
  assert.match(source, /function resetBindingsToPreset\(\)[\s\S]*?resetInputTest\(\);[\s\S]*?renderBindings\(\);\s*schedulePlanRefresh\(\);/u);
  assert.match(source, /inputBinding = structuredClone\(result\.binding\);\s*resetInputTest\(\{ notify: false \}\);[\s\S]*?renderBindings\(\);\s*schedulePlanRefresh\(\);/u);
  assert.match(source, /function applyResearchSettings\(settings, \{[\s\S]*?inputBinding = structuredClone\(normalized\.input\);\s*resetInputTest\(\);/u);
  assert.match(source, /if \(target\.dataset\.colorReset\)[\s\S]*?refreshProjection\(\);\s*schedulePlanRefresh\(\);/u);
  assert.match(source, /function schedulePlanRefresh\(\)[\s\S]*?settingsSnapshot = null;[\s\S]*?plan = null;[\s\S]*?capabilities\.manifestReady = false;/u);
});

test("the active entrypoints load only the shared Research instrument", async () => {
  const [siteIndex, desktopIndex, browserEntry, nativeEntry, bootstrap] = await Promise.all([
    read("site/index.html"),
    read("desktop/index.html"),
    read("site/src/research/browser-entry.js"),
    read("site/src/research/native-entry.js"),
    read("site/src/research/ui-bootstrap.js"),
  ]);
  assert.match(siteIndex, /id="research-app" data-research-surface="browser"/u);
  assert.match(siteIndex, /src="\.\/src\/research\/browser-entry\.js"/u);
  assert.match(siteIndex, /href="\.\/research\.css\?v=0\.4\.0-alpha\.1"/u);
  assert.match(desktopIndex, /id="research-app" data-research-surface="tauri"/u);
  assert.match(desktopIndex, /src="\.\.\/site\/src\/research\/native-entry\.js"/u);
  assert.match(desktopIndex, /href="\.\.\/site\/research\.css\?v=0\.4\.0-alpha\.1"/u);
  assert.match(browserEntry, /initializeRuntime: bootRuntimeBridge/u);
  assert.match(nativeEntry, /initializeRuntime: bootNativeBridge/u);
  assert.equal((bootstrap.match(/DOMContentLoaded/gu) ?? []).length, 1);
  assert.match(bootstrap, /bootResearchUi\(\{ surface \}\)[\s\S]*await initializeRuntime\(root\)/u);
  for (const html of [siteIndex, desktopIndex]) {
    assert.equal((html.match(/<script/gu) ?? []).length, 1);
    assert.doesNotMatch(html, /(?:webxr|party|ground-control|polar|face-|touch-playground|vdo\.ninja)/iu);
  }
});

test("the Research stylesheet passes the compact Uncodixfy guardrails", async () => {
  const css = await read("site/research.css");
  assert.doesNotMatch(css, /(?:linear|radial|conic)-gradient\s*\(/iu);
  assert.doesNotMatch(css, /backdrop-filter|text-transform|letter-spacing/iu);
  // The user-requested confirmation edge is the sole decorative-shadow exception.
  for (const rule of css.split("}")) {
    if (!rule.includes("box-shadow:")) continue;
    assert.match(rule, /\.setup-section-confirm-button\[data-review-state="pending"\]::after\s*\{/u);
  }
  assert.doesNotMatch(css, /\.(?:hero|eyebrow|glass|pill|dashboard-card)\b/iu);
  for (const match of css.matchAll(/border-radius:\s*([\d.]+)px/gu)) {
    assert.ok(Number(match[1]) <= 8, `border radius ${match[1]}px exceeds the compact UI limit`);
  }
  assert.match(css, /:focus-visible/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(css, /@media \(max-width: 759px\)/u);
  assert.match(css, /grid-template-columns: var\(--setup-sections-width, minmax\(0, 1\.666667fr\)\) 8px minmax\(0, 1fr\)/u);
});

test("Setup remains scrollable and narrow pane headers own intrinsic height", async () => {
  const css = await read("site/research.css");
  assert.match(css, /\.research-shell\s*>\s*main\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\);[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/u);
  assert.match(css, /\.setup-mode\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\);[\s\S]*?height:\s*100%;/u);
  assert.match(css, /\.setup-layout\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?height:\s*100%;/u);
  assert.match(css, /\.setup-pane\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?max-height:\s*100%;[\s\S]*?overflow-y:\s*auto;/u);
  assert.match(css, /@media \(max-width: 759px\)[\s\S]*?\.research-shell\s*\{[\s\S]*?grid-template-rows:\s*auto auto;[\s\S]*?min-height:\s*100dvh;/u);
  assert.match(css, /@media \(max-width: 759px\)[\s\S]*?\.research-shell\s*>\s*main\s*\{[\s\S]*?display:\s*block;[\s\S]*?overflow:\s*visible;/u);
  assert.match(css, /@container setup-pane \(max-width: 479px\)[\s\S]*?grid-template-areas:[\s\S]*?"number title review chevron"[\s\S]*?"\. summary summary \."[\s\S]*?white-space:\s*normal;/u);
  assert.match(css, /@media \(max-width: 479px\)[\s\S]*?\.workspace-location-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?\.workspace-location-actions\s*\{[\s\S]*?justify-content:\s*flex-start;/u);
});

test("authored ISI deadlines use a monotonic clock while wall time remains metadata-only", async () => {
  const runtime = await read("site/src/research/runtime-bridge.js");
  assert.match(runtime, /intervalEndsAt = this\.run\.intervalPausedForVisibility[\s\S]*?this\.monotonicNow\(\) \+ interval\.durationMs/u);
  assert.match(runtime, /intervalEndsAt \?\? 0\) - this\.monotonicNow\(\)/u);
  assert.match(runtime, /intervalRemainingMs = remainingMs/u,
    "visibility loss freezes the remaining monotonic interval instead of consuming hidden time");
  for (const match of runtime.matchAll(/const transitionStartedAt = this\.(\w+)\(\)/gu)) {
    assert.equal(match[1], "monotonicNow");
  }
  const intervalBranch = runtime.slice(
    runtime.indexOf('if (step.kind === "interval")'),
    runtime.indexOf("this.run.questionnaireActive = false", runtime.indexOf('if (step.kind === "interval")') + 1),
  );
  assert.doesNotMatch(intervalBranch, /epochNow/u);
});

test("custom research controls expose one coherent accessible interaction model", async () => {
  const [markup, source, preview, css] = await Promise.all([
    Promise.resolve(renderResearchUiMarkup("browser")),
    read("site/src/research/app.js"),
    read("site/src/research/preview.js"),
    read("site/research.css"),
  ]);
  assert.match(markup, /id="video-drop-zone"[^>]*role="group"/u);
  assert.doesNotMatch(markup, /id="video-drop-zone"[^>]*(?:tabindex|role="button")/u);
  assert.doesNotMatch(markup, /role="application"/u);
  assert.match(markup, /id="participant-grid"[^>]*role="radiogroup"/u);
  assert.match(source, /button\.setAttribute\("role", "radio"\);[\s\S]*?button\.setAttribute\("aria-checked"/u);
  assert.doesNotMatch(source, /button\.setAttribute\("aria-selected"/u);
  assert.match(markup, /data-color-reset="halo" aria-label="Reset Halo color"/u);
  assert.match(markup, /aria-label="Oscillation Frequency minimum \(Hz\)"/u);
  assert.match(markup, /id="run-video"[^>]*aria-label="Protocol-controlled current stimulus video"/u);
  assert.match(source, /syncControlValidation[\s\S]*?aria-invalid[\s\S]*?aria-errormessage/u);
  assert.match(source, /queueMicrotask\(\(\) => proceed\.focus\(\)\)/u);
  assert.doesNotMatch(preview, /addEventListener\("keydown"/u);
  assert.match(css, /@media \(forced-colors: active\)/u);
});

test("Run feedback projection owns its visible coordinate receipt as well as the stage", async () => {
  const source = await read("site/src/research/app.js");
  assert.match(source, /createResearchPreview\(root\.querySelector\('\[data-mode-panel="run"\]'\)/u);
  assert.doesNotMatch(source, /createResearchPreview\(root\.querySelector\("\.run-feedback-stage"\)/u);
});
