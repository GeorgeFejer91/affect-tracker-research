import { canonicalJson } from "./canonical.js";
import { applyVariantAuthoringOperation, validateVariantAuthoringDraft } from "./planner-authoring-p3.js";
import { videoLibraryCsv } from "./stimulus-order.js";
import { validateVariantLibrary as validateVideoLibrary } from "./variant-library.js";
import { videoLibraryWorkbook } from "./stimulus-workbook.js";
import { normalizeVariantCatalogue, validateVariantCatalogueLibrary } from "./variant-video-catalogue.js";
import { normalizeVariantCatalogueSource, projectSavedVariantCatalogue, projectVariantCatalogue } from "./variant-catalogue-adapter.js";
import { addIsiDurations, addVariantColumn, addVariantRow, compileVariantTimeline, createVariantDraft, createVariantDocument, editIsi, migrateLegacyOrder, pasteVariantTable, removeIsi, resolveVariantCell, resolveVariantEntries, validateStoredVariantDocument, validateVariantDraft, validateVariantDesign, variantDesignToDraft, videoColorMap } from "./variant-design.js";

const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const durationInput = value => value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value;
const moveControls = (kind, index, length, locked, label) => [-1, 1].map(direction => {
  const position = kind === "variant" ? direction < 0 ? "left" : "right" : direction < 0 ? "up" : "down";
  const arrow = kind === "variant" ? direction < 0 ? "←" : "→" : direction < 0 ? "↑" : "↓";
  return `<button type="button" data-order-move="${kind}" data-order-index="${index}" data-order-direction="${direction}" aria-label="Move ${escape(label)} ${position}" ${locked || index + direction < 0 || index + direction >= length ? "disabled" : ""}>${arrow}</button>`;
}).join("");

/** P3 presentation owner. P1 supplies library receipts; P7 consumes accepted snapshots. */
export function createStimulusOrderEditor({ root, operate, onChange = () => {}, announce = () => {} }) {
  let draft = createVariantDraft(), library = null, confirmed = null, busy = false, generation = 0, edited = false;
  let catalogue = null, lastCatalogue = null, catalogueExpected = false, legacy = null, colors = new Map();
  let catalogueOperation = 0, restoreOperation = 0, producerIdentity = null, producerRevision = null;
  let unresolvedP1Revision = null;
  let destroyed = false, authoringPublicationPending = false;
  const host = root.querySelector("#stimulus-order-editor"), status = root.querySelector("#stimulus-order-status"), versions = root.querySelector("#stimulus-order-versions");
  const report = (message, failed = false) => {
    if (status) { status.textContent = message; status.dataset.state = failed ? "error" : "ready"; }
    announce(message);
  };
  const notify = () => { onChange(); root.researchUi?.plannerContributionChanged?.("P3"); };
  function changed() { confirmed = null; edited = true; generation++; if (versions) versions.replaceChildren(); notify(); }
  function beginRestore() { catalogueOperation++; return ++restoreOperation; }
  function checkCatalogue(next) {
    if (next && lastCatalogue && (next.revision < lastCatalogue.revision
      || (next.revision === lastCatalogue.revision && canonicalJson(next) !== canonicalJson(lastCatalogue)))) {
      throw new TypeError("Segment 1 changed catalogue content without a new revision. Confirm Segment 1 again.");
    }
    return next;
  }
  function snapshot() {
    return { revision: generation, enabled: edited || Boolean(confirmed) || Boolean(legacy),
      pending: busy || edited || Boolean(legacy) || Boolean(library && !confirmed) || (catalogueExpected && !catalogue),
      contribution: confirmed ? structuredClone(confirmed.contribution) : null,
      dependencyRevisions: catalogue ? [{ segment: "P1", revision: catalogue.revision }]
        : unresolvedP1Revision !== null ? [{ segment: "P1", revision: unresolvedP1Revision }] : [] };
  }
  function restoreBinding(receipt, next) {
    const binding = checkCatalogue(normalizeVariantCatalogue(Object.hasOwn(receipt, "catalogue") ? receipt.catalogue : catalogue));
    if (binding || catalogueExpected || Object.hasOwn(receipt, "catalogue")) validateVariantCatalogueLibrary(binding, next);
    return binding;
  }
  async function restoreReceipt(receipt) {
    if (!receipt?.dependencies) return receipt;
    const source = normalizeVariantCatalogueSource(receipt.dependencies.P1);
    if (producerRevision !== null && source.revision < producerRevision) throw new TypeError("The Segment 1 catalogue revision is stale.");
    const projection = await projectVariantCatalogue(source);
    return { ...receipt, library: projection.library, catalogue: projection, producerIdentity: canonicalJson(source), producerRevision: source.revision };
  }
  function commitRestore(document, next, binding, receipt) {
    catalogueOperation++; producerIdentity = receipt.producerIdentity ?? null;
    unresolvedP1Revision = null;
    producerRevision = receipt.producerRevision ?? producerRevision;
    library = next; catalogue = binding;
    if (binding) { lastCatalogue = binding; catalogueExpected = true; }
    colors = videoColorMap(library); draft = structuredClone(document.draft); confirmed = document;
    edited = false; legacy = null; generation++; render(); notify();
    return snapshot();
  }
  function describe(cell) {
    try {
      const value = resolveVariantCell(cell, library, draft.isiDefinitions);
      if (!value) return { kind: "empty", cue: "", color: "" };
      if (value.kind === "isi") return { kind: "isi", cue: `ISI · ${value.durationMs} ms`, color: "" };
      const video = (catalogue?.videos ?? library.videos).find(item => item.annotationId === cell);
      return { kind: "video", cue: `Video · ${Number.isSafeInteger(video?.durationMs) ? `${video.durationMs} ms` : "full duration"}`, color: colors.get(cell) };
    } catch { return { kind: "invalid", cue: "Unknown video or ISI name", color: "" }; }
  }
  const cellMarkup = (cell, r, c, locked) => {
    const info = describe(cell);
    return `<td data-order-kind="${info.kind}"${info.color ? ` style="--video-color:${info.color}"` : ""}><input data-order-row="${r}" data-order-column="${c}" aria-label="Event ${r + 1}, ${escape(draft.columns[c].title)}" aria-describedby="stimulus-order-help stimulus-order-status" ${info.kind === "invalid" ? 'aria-invalid="true"' : ""} list="video-annotation-options" value="${escape(cell)}" autocomplete="off" spellcheck="false" placeholder="Video ID or ISI name" ${locked ? "disabled" : ""}><span class="order-cell-cue">${escape(info.cue)}</span></td>`;
  };
  function renderVersions() {
    if (!versions) return;
    if (legacy) { versions.innerHTML = '<button type="button" data-order-convert-legacy>Convert saved design</button>'; return; }
    versions.innerHTML = confirmed ? `<details class="inner-disclosure"><summary>${confirmed.contribution.variants.length} variants · versions and planned events</summary><div class="disclosure-content">${confirmed.contribution.variants.map(variant => {
      let timing;
      try { const timeline = compileVariantTimeline(confirmed.contribution, variant.variantId, catalogue?.videos ?? library.videos); timing = `<p>Planned duration: ${timeline.plannedDurationMs} ms. Actual times are recorded by the Runner.</p>`; }
      catch { timing = "<p>Planned offsets need verified video durations from Segment 1. The ordered boundaries below are preserved.</p>"; }
      return `<h4>${escape(variant.title)} · ${variant.variantId}</h4><p class="variant-versions"><code>${variant.versionSha256}</code></p>${timing}<ol class="planned-events">${variant.entries.map(entry => `<li>${escape(entry.referenceId)} · ${entry.kind === "isi" ? "ISI" : "Video"} start → end <small>${entry.entryId}</small></li>`).join("")}</ol>`;
    }).join("")}</div></details>` : "";
  }
  function render() {
    if (!host) return;
    host.hidden = !library;
    const section = host.closest?.('[data-setup-section="stimuli"]');
    if (section) section.dataset.libraryReady = String(Boolean(library));
    root.querySelectorAll("[data-order-requires-library]").forEach(element => { element.hidden = !library; });
    root.querySelectorAll("[data-order-prerequisite]").forEach(element => { element.hidden = Boolean(library); });
    const locked = busy || !library;
    host.innerHTML = `<div class="isi-definitions"><label for="isi-duration-list">ISI durations (ms)</label><div class="isi-create-row"><input id="isi-duration-list" data-isi-list placeholder="e.g. 500, 1500" aria-describedby="isi-list-help" ${locked ? "disabled" : ""}><button type="button" data-isi-add ${locked ? "disabled" : ""}>Add ISIs</button></div><p id="isi-list-help" class="field-help">Enter comma-separated whole milliseconds. Use the generated names in the table.</p><div class="isi-dictionary">${draft.isiDefinitions.map((isi, i) => {
      const count = draft.rows.reduce((total, row) => total + row.filter(cell => cell === isi.isiId).length, 0);
      return `<div class="isi-definition"><label for="duration-${isi.isiId}">${isi.isiId}</label><input id="duration-${isi.isiId}" data-isi-id="${isi.isiId}" type="number" min="0" max="3600000" step="1" value="${escape(isi.durationMs ?? "")}" aria-label="${isi.isiId} duration in milliseconds" ${locked ? "disabled" : ""}><span data-isi-usage="${isi.isiId}">ms · ${count} use${count === 1 ? "" : "s"}</span><div class="button-row">${moveControls("isi", i, draft.isiDefinitions.length, locked, isi.isiId)}<button type="button" data-isi-remove="${isi.isiId}" aria-label="Remove ${isi.isiId}" ${locked || count ? "disabled" : ""}>×</button></div></div>`;
    }).join("")}</div></div><div class="table-scroll stimulus-order-scroll" tabindex="0" role="region" aria-label="Stimulus presentation order"><table class="stimulus-order-table"><caption class="sr-only">Each column is a variant. Enter video annotations or named ISIs.</caption><thead><tr><th scope="col">Event</th>${draft.columns.map((column, c) => `<th scope="col"><div class="variant-heading"><input data-order-title="${c}" aria-label="Variant ${c + 1} name" maxlength="120" value="${escape(column.title)}" ${locked ? "disabled" : ""}>${moveControls("variant", c, draft.columns.length, locked, column.title)}<button type="button" data-order-remove-column="${c}" aria-label="Remove ${escape(column.title)}" ${locked || draft.columns.length === 1 ? "disabled" : ""}>×</button></div></th>`).join("")}<th scope="col"><span class="sr-only">Row actions</span></th></tr></thead><tbody>${draft.rows.map((row, r) => `<tr><th scope="row">Event ${r + 1}</th>${row.map((cell, c) => cellMarkup(cell, r, c, locked)).join("")}<td><div class="button-row">${moveControls("row", r, draft.rows.length, locked, `Event ${r + 1}`)}<button type="button" data-order-remove-row="${r}" aria-label="Remove Event ${r + 1}" ${locked || draft.rows.length === 1 ? "disabled" : ""}>×</button></div></td></tr>`).join("")}</tbody></table></div><div class="button-row"><button type="button" data-order-add-row ${locked ? "disabled" : ""}>Add event</button><button type="button" data-order-add-column ${locked ? "disabled" : ""}>Add variant</button><button type="button" data-order-reset ${locked ? "disabled" : ""}>Reset table</button></div><datalist id="video-annotation-options">${(library?.videos ?? []).map(video => `<option value="${escape(video.annotationId)}">${escape(video.relativePath.slice("assets/stimuli/".length))}</option>`).join("")}${draft.isiDefinitions.map(isi => `<option value="${isi.isiId}">ISI · ${isi.durationMs} ms</option>`).join("")}</datalist>`;
    root.querySelectorAll("[data-video-library-export]").forEach(button => { button.disabled = locked || !library?.videos.length; });
    root.querySelectorAll('[data-confirm-section="stimuli"]').forEach(button => { if (button.dataset.reviewState !== "reviewed") button.disabled = locked; });
    renderVersions();
  }
  function validatePending() { const variants = resolveVariantEntries(draft, library); report(`${variants.length} variant${variants.length === 1 ? "" : "s"}. Changes pending confirmation.`); }
  function use(next, focus) {
    validateVariantDraft(next); draft = next; changed(); render();
    if (focus) host?.querySelector(focus)?.focus();
    try { validatePending(); } catch (error) { report(error.message, true); }
  }
  async function adopt(receipt, { loadSaved = false } = {}) {
    const token = generation, restoreToken = restoreOperation, next = await validateVideoLibrary(receipt.library ?? receipt);
    if (token !== generation || restoreToken !== restoreOperation) throw new Error("The workspace or table changed during the library scan. Rescan the library.");
    const design = loadSaved && !edited && receipt.design ? await validateStoredVariantDocument(receipt.design, next) : null;
    if (token !== generation || restoreToken !== restoreOperation) throw new Error("The workspace or table changed while loading. Confirm Segment 1 again.");
    const stale = library?.integritySha256 !== next.integritySha256;
    library = next; colors = videoColorMap(library);
    if (stale || receipt.designError) { generation++; catalogueOperation++; producerIdentity = null; if (confirmed || receipt.designError) edited = true; confirmed = null; catalogue = null; legacy = null; notify(); }
    if ([2, 3].includes(design?.version)) { draft = structuredClone(design.draft); confirmed = catalogueExpected && !catalogue ? null : design; edited = !confirmed; }
    if (design?.version === 1) { legacy = design; report("A legacy numeric-ISI design is saved. Use Convert saved design to review its named ISIs before confirming."); }
    else report(receipt.designError || `${library.videos.length} videos available. Define ISIs and paste the variant columns.`, Boolean(receipt.designError));
    render(); notify();
  }
  async function confirmLibrary() {
    if (busy) return false;
    busy = true; const token = generation, restoreToken = restoreOperation; render();
    const workspaceStatus = root.querySelector("#workspace-status");
    if (workspaceStatus) workspaceStatus.textContent = "Reading video identities and saving the library annotations…";
    try {
      const receipt = await operate("confirm-library");
      if (token !== generation || restoreToken !== restoreOperation) throw new Error("The workspace changed during confirmation. Confirm Segment 1 again.");
      await adopt(receipt, { loadSaved: true });
      if (workspaceStatus) workspaceStatus.textContent = `${library.videos.length} video annotations saved. Segment 3 is ready.`;
      return true;
    } catch (error) { if (token === generation && restoreToken === restoreOperation) { if (workspaceStatus) workspaceStatus.textContent = error.message; report(error.message, true); } return false; }
    finally { busy = false; render(); notify(); }
  }
  async function confirm() {
    if (busy || !library) { report("Confirm the video library in Segment 1 first.", true); return false; }
    busy = true; const token = generation, restoreToken = restoreOperation; let issue = null; render();
    try {
      if (catalogueExpected) validateVariantCatalogueLibrary(catalogue, library);
      const document = await createVariantDocument(draft, library);
      if (token !== generation || restoreToken !== restoreOperation) throw new Error("The table or catalogue changed before saving. Confirm the current table again.");
      const receipt = await operate("save-order", { document });
      const saved = await validateStoredVariantDocument(receipt.design, library);
      if (token !== generation || restoreToken !== restoreOperation || canonicalJson(saved) !== canonicalJson(document)) throw new Error("The table changed while saving. Confirm the current table again.");
      confirmed = saved; edited = false; legacy = null; generation++; notify();
      report(`${saved.contribution.variants.length} variants saved with version annotations. Allocation policy belongs to the Runner.`);
      return true;
    } catch (error) { issue = error; if (token === generation && restoreToken === restoreOperation) report(error.message, true); return false; }
    finally {
      busy = false; render(); notify();
      if (issue && token === generation && restoreToken === restoreOperation) revealIssue(issue);
    }
  }
  async function prepareContribution({ isCurrent = () => true } = {}) {
    if (busy || !library) throw new Error("Confirm the video catalogue in Segment 1 first.");
    busy = true; const token = generation, restoreToken = restoreOperation; let issue = null; render();
    try {
      validateVariantCatalogueLibrary(catalogue, library);
      const document = await createVariantDocument(draft, library);
      for (const variant of document.contribution.variants) compileVariantTimeline(document.contribution, variant.variantId, catalogue?.videos ?? []);
      if (token !== generation || restoreToken !== restoreOperation || !isCurrent()) throw new Error("The table or catalogue changed during confirmation. Confirm the current table again.");
      confirmed = document; edited = false; legacy = null; generation++;
      report(`${document.contribution.variants.length} variants ready for review.`);
    } catch (error) { issue = error; if (token === generation && restoreToken === restoreOperation) report(error.message, true); throw error; }
    finally { busy = false; render(); notify(); if (issue && token === generation && restoreToken === restoreOperation) revealIssue(issue); }
    return snapshot();
  }
  function revealIssue(error) {
    const isiId = /^(ISI[1-9][0-9]*) duration/u.exec(error.message)?.[1];
    const selector = Number.isInteger(error.row) && Number.isInteger(error.column)
      ? `[data-order-row="${error.row}"][data-order-column="${error.column}"]`
      : isiId ? `[data-isi-id="${isiId}"]` : null;
    const control = selector ? host?.querySelector(selector) : null;
    if (control) {
      control.setAttribute("aria-invalid", "true");
      control.focus({ preventScroll: true });
      control.scrollIntoView?.({ block: "nearest", inline: "center", behavior: "instant" });
    } else if (status) {
      status.tabIndex = -1; status.focus?.({ preventScroll: true });
      status.scrollIntoView?.({ block: "nearest", behavior: "instant" });
    }
  }
  function updateCellCue(control) {
    const parent = control.closest?.("td"), info = describe(control.value);
    if (!parent) return;
    parent.dataset.orderKind = info.kind; parent.style?.setProperty("--video-color", info.color);
    const cue = parent.querySelector(".order-cell-cue"); if (cue) cue.textContent = info.cue;
  }
  function refreshCues() {
    host?.querySelectorAll?.("[data-order-row]").forEach(updateCellCue);
    for (const isi of draft.isiDefinitions) {
      const count = draft.rows.reduce((total, row) => total + row.filter(cell => cell === isi.isiId).length, 0);
      const usage = host?.querySelector('[data-isi-usage="' + isi.isiId + '"]');
      const remove = host?.querySelector('[data-isi-remove="' + isi.isiId + '"]');
      if (usage) usage.textContent = 'ms · ' + count + ' use' + (count === 1 ? '' : 's');
      if (remove) remove.disabled = busy || count > 0;
    }
  }
  const onInput = event => {
    const control = event.target;
    if (busy || (control.dataset.orderRow === undefined && control.dataset.orderTitle === undefined && control.dataset.isiId === undefined)) return;
    if (control.dataset.orderRow !== undefined) draft.rows[Number(control.dataset.orderRow)][Number(control.dataset.orderColumn)] = control.value;
    else if (control.dataset.orderTitle !== undefined) draft.columns[Number(control.dataset.orderTitle)].title = control.value;
    else draft.isiDefinitions.find(isi => isi.isiId === control.dataset.isiId).durationMs = durationInput(control.value);
    changed(); refreshCues(); control.removeAttribute("aria-invalid");
  };
  const onEdit = event => {
    const control = event.target;
    if (busy || !library || (control.dataset.orderRow === undefined && control.dataset.orderTitle === undefined && control.dataset.isiId === undefined)) return;
    try {
      if (control.dataset.orderRow !== undefined) {
        const r = Number(control.dataset.orderRow), c = Number(control.dataset.orderColumn); draft.rows[r][c] = control.value;
        resolveVariantCell(control.value.trim(), library, draft.isiDefinitions); draft.rows[r][c] = control.value.trim(); control.value = draft.rows[r][c];
      } else if (control.dataset.orderTitle !== undefined) draft.columns[Number(control.dataset.orderTitle)].title = control.value;
      else {
        const durationMs = durationInput(control.value);
        draft.isiDefinitions.find(isi => isi.isiId === control.dataset.isiId).durationMs = durationMs;
        draft = editIsi(draft, control.dataset.isiId, durationMs);
      }
      changed(); refreshCues(); validatePending();
    } catch (error) { changed(); control.setAttribute("aria-invalid", "true"); report(error.message, true); }
  };
  const onPaste = event => {
    const control = event.target;
    if (busy || !library || control.dataset.orderRow === undefined) return;
    event.preventDefault();
    try { const r = Number(control.dataset.orderRow), c = Number(control.dataset.orderColumn); use(pasteVariantTable(draft, r, c, event.clipboardData?.getData("text/plain") ?? "", library), `[data-order-row="${r}"][data-order-column="${c}"]`); }
    catch (error) { report(error.message, true); }
  };
  const onClick = event => {
    const button = event.target.closest?.("button");
    if (!button || busy || !library) return;
    try {
      if (button.dataset.orderMove) {
        const kind = button.dataset.orderMove, index = Number(button.dataset.orderIndex), direction = Number(button.dataset.orderDirection);
        const list = kind === "variant" ? draft.columns : kind === "isi" ? draft.isiDefinitions : draft.rows;
        if (![-1, 1].includes(direction) || index < 0 || index + direction < 0 || index + direction >= list.length) return;
        const beforeIndex = direction < 0 ? index - 1 : index + 2;
        const args = kind === "variant" ? { variantId: draft.columns[index].variantId, beforeVariantId: draft.columns[beforeIndex]?.variantId ?? null }
          : kind === "isi" ? { isiId: draft.isiDefinitions[index].isiId, beforeIsiId: draft.isiDefinitions[beforeIndex]?.isiId ?? null }
            : { entryId: draft.entryIds[index][0], beforeEntryId: draft.entryIds[beforeIndex]?.[0] ?? null };
        use(applyVariantAuthoringOperation(draft, `${kind}.move`, args, library), `[data-order-move="${kind}"][data-order-index="${index + direction}"][data-order-direction="${direction}"]`);
      }
      else if (button.hasAttribute("data-order-reset")) use(applyVariantAuthoringOperation(draft, "table.reset", {}, library), "[data-order-add-row]");
      else if (button.hasAttribute("data-isi-add")) use(addIsiDurations(draft, host.querySelector("[data-isi-list]")?.value ?? ""), "[data-isi-list]");
      else if (button.dataset.isiRemove) use(removeIsi(draft, button.dataset.isiRemove), "[data-isi-list]");
      else if (button.hasAttribute("data-order-convert-legacy") && legacy) { const next = migrateLegacyOrder(legacy); legacy = null; use(next); report("Legacy order converted to named ISIs. Original file is preserved until you confirm this revision."); }
      else if (button.hasAttribute("data-order-add-row")) use(addVariantRow(draft), `[data-order-row="${draft.rows.length}"][data-order-column="0"]`);
      else if (button.hasAttribute("data-order-add-column")) use(addVariantColumn(draft), `[data-order-title="${draft.columns.length}"]`);
      else if (button.dataset.orderRemoveRow !== undefined) { const next = structuredClone(draft), r = Number(button.dataset.orderRemoveRow); next.rows.splice(r, 1); next.entryIds.splice(r, 1); use(next, "[data-order-add-row]"); }
      else if (button.dataset.orderRemoveColumn !== undefined) { const next = structuredClone(draft), c = Number(button.dataset.orderRemoveColumn); next.columns.splice(c, 1); next.rows.forEach(row => row.splice(c, 1)); next.entryIds.forEach(row => row.splice(c, 1)); use(next, "[data-order-add-column]"); }
    } catch (error) { report(error.message, true); }
  };
  host?.addEventListener("input", onInput); host?.addEventListener("change", onEdit); host?.addEventListener("paste", onPaste); host?.addEventListener("click", onClick);
  versions?.addEventListener?.("click", onClick); render();
  return {
    confirm, confirmLibrary, adopt, prepareContribution,
    // Command adapters project the existing owner draft. No second state store
    // or accepted contribution is created by an atomic authoring edit.
    captureAuthoringDraft() {
      return structuredClone({ draft, library, catalogue, legacy,
        contribution: confirmed?.contribution ?? null, busy, destroyed });
    },
    stageAuthoringDraftRestore(rawDraft, guard) {
      return this.stageAuthoringDraft(() => validateVariantAuthoringDraft(rawDraft), guard);
    },
    stageAuthoringDraft(project, { isCurrent = () => true, signal } = {}) {
      if (destroyed || busy || legacy) throw new Error("The variant editor is unavailable, busy or awaiting legacy conversion.");
      const token = generation, scan = catalogueOperation, restoreToken = restoreOperation;
      const nextGeneration = generation + 1;
      if (!Number.isSafeInteger(nextGeneration)) throw new Error("The variant editor revision is exhausted.");
      const current = () => !destroyed && !busy && token === generation && scan === catalogueOperation
        && restoreToken === restoreOperation && !signal?.aborted && isCurrent();
      if (!current()) throw new Error("The variant authoring operation is no longer current.");
      // The owner adapter validates its entire ordered batch on this detached
      // capture. Clone before returning so commit cannot depend on caller data.
      const next = structuredClone(project(this.captureAuthoringDraft()));
      if (!current()) throw new Error("The variant authoring operation is no longer current.");
      return { isCurrent: current, commit() {
        draft = next; confirmed = null; legacy = null; edited = true;
        generation = nextGeneration; catalogueOperation++; restoreOperation++;
        authoringPublicationPending = true;
      } };
    },
    publishAuthoringDraft() {
      if (!authoringPublicationPending || destroyed) return;
      authoringPublicationPending = false;
      render(); notify();
      try { validateVariantDraft(draft); if (library) validatePending(); else report("Confirm the video library in Segment 1 before confirming this table."); }
      catch (error) { report(error.message, true); }
    },
    async restore(document, receipt) {
      const token = generation, operation = beginRestore();
      receipt = await restoreReceipt(receipt);
      const next = await validateVideoLibrary(receipt.library ?? receipt);
      const binding = restoreBinding(receipt, next);
      const verified = await validateStoredVariantDocument(document, next);
      if (token !== generation || operation !== restoreOperation || receipt.isCurrent?.() === false) throw new Error("The design changed while reopening.");
      if (![2, 3].includes(verified.version)) throw new Error("Legacy designs require explicit conversion.");
      const result = commitRestore(verified, next, binding, receipt);
      report(`${confirmed.contribution.variants.length} variants reopened. Edits require confirmation.`);
      return result;
    },
    async restoreContribution(contribution, receipt) {
      const token = generation, operation = beginRestore();
      receipt = await restoreReceipt(receipt);
      const next = await validateVideoLibrary(receipt.library ?? receipt);
      const binding = restoreBinding(receipt, next);
      const accepted = await validateVariantDesign(contribution, next);
      const document = await createVariantDocument(variantDesignToDraft(accepted), next);
      if (token !== generation || operation !== restoreOperation || receipt.isCurrent?.() === false) throw new Error("The design changed while reopening.");
      return commitRestore(document, next, binding, receipt);
    },
    async prepareRestoreContent(contribution, { savedWorkspaceContribution, dependencies, isCurrent = () => true }) {
      const token = generation, operation = restoreOperation, scan = catalogueOperation;
      const source = normalizeVariantCatalogueSource(dependencies?.P1), identity = canonicalJson(source);
      const nextGeneration = generation + 1;
      let committed = false, projected = false;
      const current = () => {
        try { return !committed && !destroyed && token === generation && operation === restoreOperation
          && scan === catalogueOperation && isCurrent()
          && canonicalJson(normalizeVariantCatalogueSource(dependencies?.P1)) === identity; }
        catch { return false; }
      };
      const check = () => { if (!current()) throw new Error("The design changed while reopening."); };
      check();
      if (!Number.isSafeInteger(nextGeneration)) throw new Error("The variant editor revision is exhausted.");
      if (producerRevision !== null && source.revision < producerRevision) throw new TypeError("The Segment 1 catalogue revision is stale.");
      // Snapshot caller content before the first await; the live dependency is
      // intentionally reread by the guard, never replaced by saved readiness.
      const saved = structuredClone(savedWorkspaceContribution), content = structuredClone(contribution);
      const declared = await projectSavedVariantCatalogue(saved);
      const accepted = await validateVariantDesign(content, declared.library);
      const restoredDraft = variantDesignToDraft(accepted), restoredColors = videoColorMap(declared.library);
      check();
      return {
        isCurrent: current,
        commit() {
          check();
          catalogueOperation++; restoreOperation++;
          producerIdentity = identity; producerRevision = source.revision;
          unresolvedP1Revision = source.revision; catalogueExpected = true; catalogue = null;
          library = declared.library; colors = restoredColors; draft = restoredDraft;
          confirmed = null; legacy = null; edited = true; generation = nextGeneration;
          authoringPublicationPending = false; committed = true;
        },
        afterCommit() {
          if (!committed) throw new Error("Commit the reopened design before publishing its projection.");
          if (projected) return;
          projected = true;
          if (destroyed || generation !== nextGeneration) return;
          render(); notify();
          report("Variant table reopened. Confirm the video library in Segment 1 before confirming this table.");
        },
      };
    },
    async restoreContent(contribution, options) {
      // GUI reopen retains immediate supersession of earlier saves/restores.
      // The separately exposed preparation method itself makes no reservation.
      beginRestore();
      const prepared = await this.prepareRestoreContent(contribution, options);
      prepared.commit(); prepared.afterCommit();
      return snapshot();
    },
    setCatalogue(snapshot) {
      catalogueOperation++; producerIdentity = null; unresolvedP1Revision = null;
      let next;
      try { next = checkCatalogue(normalizeVariantCatalogue(snapshot)); }
      catch (error) { catalogueExpected = true; catalogue = null; changed(); render(); report(error.message, true); throw error; }
      if (catalogueExpected && canonicalJson(next) === canonicalJson(catalogue)) return;
      catalogueExpected = true; catalogue = next; if (next) lastCatalogue = next;
      changed(); render(); notify();
    },
    async setCatalogueSource(input) {
      let source, identity;
      try {
        source = normalizeVariantCatalogueSource(input); identity = canonicalJson(source);
        if (producerRevision !== null && source.revision < producerRevision) throw new TypeError("The Segment 1 catalogue revision is stale.");
      }
      catch (error) { catalogueOperation++; producerIdentity = null; unresolvedP1Revision = null; catalogueExpected = true; catalogue = null; changed(); render(); report(error.message, true); throw error; }
      if (identity === producerIdentity && catalogue) return snapshot();
      const operation = ++catalogueOperation;
      producerRevision = source.revision; unresolvedP1Revision = source.revision;
      producerIdentity = identity; catalogueExpected = true; catalogue = null; changed(); render();
      if (!source.enabled || source.pending || source.contribution === null) return snapshot();
      try {
        const projection = await projectVariantCatalogue(source);
        if (operation !== catalogueOperation) return snapshot();
        checkCatalogue(projection);
        catalogue = projection; lastCatalogue = projection; unresolvedP1Revision = null; library = projection.library; colors = videoColorMap(library);
        changed(); render(); return snapshot();
      } catch (error) { if (operation === catalogueOperation) report(error.message, true); throw error; }
    },
    getSnapshot: snapshot,
    reset() { generation++; catalogueOperation++; producerIdentity = null; producerRevision = null; unresolvedP1Revision = null; library = null; catalogue = null; lastCatalogue = null; catalogueExpected = false; confirmed = null; legacy = null; draft = createVariantDraft(); edited = false; render(); notify(); },
    get document() { return confirmed ? structuredClone(confirmed) : null; },
    get active() { return edited || Boolean(confirmed) || Boolean(legacy); },
    get pending() { return snapshot().pending; },
    async download(format) {
      if (busy) return;
      busy = true; const token = generation, restoreToken = restoreOperation; render();
      const isCurrent = () => token === generation && restoreToken === restoreOperation;
      try {
        if (!library || !["csv", "xlsx"].includes(format)) throw new Error("Confirm the video library before downloading.");
        const verified = await validateVideoLibrary(library);
        if (!isCurrent()) return;
        const bytes = format === "csv" ? new TextEncoder().encode(videoLibraryCsv(verified)) : videoLibraryWorkbook(verified);
        await operate("export-library", { format, bytes, librarySha256: verified.integritySha256,
          ...(verified.version === 2 ? { catalogue: verified.catalogue } : {}) });
        if (isCurrent()) report(`Video library ${format.toUpperCase()} export ready.`);
      } catch (error) { if (isCurrent()) report(error.message, true); }
      finally { busy = false; render(); notify(); }
    },
    destroy() { destroyed = true; authoringPublicationPending = false; generation++; catalogueOperation++; host?.removeEventListener("input", onInput); host?.removeEventListener("change", onEdit); host?.removeEventListener("paste", onPaste); host?.removeEventListener("click", onClick); versions?.removeEventListener?.("click", onClick); },
  };
}
