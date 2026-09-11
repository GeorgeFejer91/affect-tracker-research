import { canonicalJson } from "./canonical.js";
import {
  addOrderColumn, addOrderRow, createStimulusOrder, createStimulusOrderDocument,
  pasteStimulusOrder, resolveStimulusVariants, setOrderCell, validateStimulusOrderDocument,
  validateVideoLibrary, videoLibraryCsv,
} from "./stimulus-order.js";
import { videoLibraryWorkbook } from "./stimulus-workbook.js";

const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** Presentation owner. Storage is injected by the one platform composition. */
export function createStimulusOrderEditor({ root, operate, onChange = () => {}, announce = () => {} }) {
  let draft = createStimulusOrder(), library = null, confirmed = null, busy = false, generation = 0, edited = false;
  const host = root.querySelector("#stimulus-order-editor");
  const status = root.querySelector("#stimulus-order-status");
  const versions = root.querySelector("#stimulus-order-versions");
  const report = (message, failed = false) => {
    if (status) { status.textContent = message; status.dataset.state = failed ? "error" : "ready"; }
    announce(message);
  };
  function changed() { confirmed = null; edited = true; generation++; if (versions) versions.replaceChildren(); onChange(); }
  function render() {
    if (!host) return;
    const locked = busy || !library;
    host.innerHTML = `<div class="table-scroll stimulus-order-scroll" tabindex="0" role="region" aria-label="Stimulus presentation order"><table class="stimulus-order-table"><caption class="sr-only">Each column is a variant. Enter video annotations or intervals in milliseconds.</caption><thead><tr><th scope="col">Event</th>${draft.columns.map((column, c) => `<th scope="col"><div class="variant-heading"><input data-order-title="${c}" aria-label="Variant ${c + 1} name" maxlength="120" value="${escape(column.title)}" ${locked ? "disabled" : ""}><button type="button" data-order-remove-column="${c}" aria-label="Remove ${escape(column.title)}" ${locked || draft.columns.length === 1 ? "disabled" : ""}>×</button></div></th>`).join("")}<th scope="col"><span class="sr-only">Row actions</span></th></tr></thead><tbody>${draft.rows.map((row, r) => `<tr><th scope="row">Event ${r + 1}</th>${row.map((cell, c) => `<td><input data-order-row="${r}" data-order-column="${c}" aria-label="Event ${r + 1}, ${escape(draft.columns[c].title)}" aria-describedby="stimulus-order-help stimulus-order-status" list="video-annotation-options" value="${escape(cell)}" autocomplete="off" spellcheck="false" placeholder="Video or ISI (ms)" ${locked ? "disabled" : ""}></td>`).join("")}<td><button type="button" data-order-remove-row="${r}" aria-label="Remove Event ${r + 1}" ${locked || draft.rows.length === 1 ? "disabled" : ""}>×</button></td></tr>`).join("")}</tbody></table></div><div class="button-row"><button type="button" data-order-add-row ${locked ? "disabled" : ""}>Add event</button><button type="button" data-order-add-column ${locked ? "disabled" : ""}>Add variant</button></div><datalist id="video-annotation-options">${(library?.videos ?? []).map((video) => `<option value="${video.annotationId}">${escape(video.relativePath.slice("assets/stimuli/".length))}</option>`).join("")}</datalist>`;
    root.querySelectorAll("[data-video-library-export]").forEach((button) => { button.disabled = locked || library.videos.length === 0; });
    root.querySelectorAll('[data-confirm-section="stimuli"]').forEach((button) => { if (button.dataset.reviewState !== "reviewed") button.disabled = locked; });
    if (versions) versions.innerHTML = confirmed ? `<details class="inner-disclosure"><summary>${confirmed.variants.length} saved variant${confirmed.variants.length === 1 ? "" : "s"} · version annotations</summary><dl class="variant-versions disclosure-content">${confirmed.variants.map((variant) => `<div><dt>${escape(variant.title)} · ${variant.variantId}</dt><dd><code>${variant.versionSha256}</code></dd></div>`).join("")}</dl></details>` : "";
  }
  function use(next, focus) {
    draft = next; changed(); render();
    if (focus) host?.querySelector(focus)?.focus();
    try { const variants = resolveStimulusVariants(draft, library); report(`${variants.length} variant${variants.length === 1 ? "" : "s"}. Changes pending confirmation.`); }
    catch (error) { report(error.message, true); }
  }
  async function adopt(receipt, { loadSaved = false } = {}) {
    const token = generation;
    const next = await validateVideoLibrary(receipt.library ?? receipt);
    if (token !== generation) throw new Error("The workspace or table changed during the library scan. Rescan the library.");
    const design = loadSaved && !edited && receipt.design ? await validateStimulusOrderDocument(receipt.design, next) : null;
    if (token !== generation) throw new Error("The workspace or table changed while loading. Confirm Segment 1 again.");
    const stale = library?.integritySha256 !== next.integritySha256;
    library = next;
    if (stale || receipt.designError) { generation++; if (confirmed || receipt.designError) edited = true; confirmed = null; onChange(); }
    if (design) {
      draft = { columns: design.columns, rows: design.rows }; confirmed = design; edited = false;
    }
    render();
    report(receipt.designError || `${library.videos.length} video${library.videos.length === 1 ? "" : "s"} in the library. Paste video annotations and ISIs into the table.`, Boolean(receipt.designError));
  }
  async function confirmLibrary() {
    if (busy) return false;
    busy = true; const token = generation; render();
    const workspaceStatus = root.querySelector("#workspace-status");
    if (workspaceStatus) workspaceStatus.textContent = "Reading video identities and saving the library annotations…";
    try {
      const receipt = await operate("confirm-library");
      if (token !== generation) throw new Error("The workspace changed during confirmation. Confirm Segment 1 again.");
      await adopt(receipt, { loadSaved: true });
      if (workspaceStatus) workspaceStatus.textContent = `${library.videos.length} video annotations saved. Segment 3 is ready for presentation orders.`;
      return true;
    }
    catch (error) { if (workspaceStatus) workspaceStatus.textContent = error.message; report(error.message, true); return false; }
    finally { busy = false; render(); }
  }
  async function confirm() {
    if (busy || !library) { report("Confirm the video library in Segment 1 first.", true); return false; }
    busy = true; const token = generation; render();
    try {
      const document = await createStimulusOrderDocument(draft, library);
      const receipt = await operate("save-order", { document });
      const saved = await validateStimulusOrderDocument(receipt.design, library);
      if (token !== generation || canonicalJson(saved) !== canonicalJson(document)) throw new Error("The table changed while saving. Confirm the current table again.");
      confirmed = saved; edited = false; onChange();
      report(`${saved.variants.length} variant${saved.variants.length === 1 ? "" : "s"} saved with version annotations. Participant allocation belongs to the Runner.`);
      return true;
    } catch (error) { report(error.message, true); return false; }
    finally { busy = false; render(); }
  }
  const onInput = (event) => {
    const control = event.target;
    if (busy) return;
    if (control.dataset.orderRow === undefined && control.dataset.orderTitle === undefined) return;
    // Invalidate a previously saved receipt immediately, including invalid edits.
    if (control.dataset.orderRow !== undefined) draft.rows[Number(control.dataset.orderRow)][Number(control.dataset.orderColumn)] = control.value;
    else draft.columns[Number(control.dataset.orderTitle)].title = control.value;
    changed(); control.removeAttribute("aria-invalid");
  };
  const onEdit = (event) => {
    const control = event.target;
    if (busy || !library) return;
    try {
      if (control.dataset.orderRow !== undefined) {
        const r = Number(control.dataset.orderRow), c = Number(control.dataset.orderColumn);
        const value = control.value;
        // Keep invalid text in the draft so confirmation cannot save stale cells.
        draft.rows[r][c] = value;
        const next = setOrderCell(draft, r, c, value, library);
        draft = next; control.value = next.rows[r][c]; changed();
      } else if (control.dataset.orderTitle !== undefined) {
        draft.columns[Number(control.dataset.orderTitle)].title = control.value;
        changed();
      }
      const variants = resolveStimulusVariants(draft, library);
      report(`${variants.length} variant${variants.length === 1 ? "" : "s"}. Changes pending confirmation.`);
    } catch (error) { changed(); control.setAttribute("aria-invalid", "true"); report(error.message, true); }
  };
  const onPaste = (event) => {
    const control = event.target;
    if (busy || !library || control.dataset.orderRow === undefined) return;
    event.preventDefault();
    try {
      const r = Number(control.dataset.orderRow), c = Number(control.dataset.orderColumn);
      use(pasteStimulusOrder(draft, r, c, event.clipboardData?.getData("text/plain") ?? "", library), `[data-order-row="${r}"][data-order-column="${c}"]`);
    } catch (error) { report(error.message, true); }
  };
  const onClick = (event) => {
    const button = event.target.closest?.("button");
    if (!button || busy || !library) return;
    try {
      if (button.hasAttribute("data-order-add-row")) use(addOrderRow(draft), `[data-order-row="${draft.rows.length}"][data-order-column="0"]`);
      else if (button.hasAttribute("data-order-add-column")) use(addOrderColumn(draft), `[data-order-title="${draft.columns.length}"]`);
      else if (button.dataset.orderRemoveRow !== undefined) { const next = structuredClone(draft); next.rows.splice(Number(button.dataset.orderRemoveRow), 1); use(next, "[data-order-add-row]"); }
      else if (button.dataset.orderRemoveColumn !== undefined) { const c = Number(button.dataset.orderRemoveColumn), next = structuredClone(draft); next.columns.splice(c, 1); next.rows.forEach((row) => row.splice(c, 1)); use(next, "[data-order-add-column]"); }
    } catch (error) { report(error.message, true); }
  };
  host?.addEventListener("input", onInput); host?.addEventListener("change", onEdit); host?.addEventListener("paste", onPaste); host?.addEventListener("click", onClick);
  render();
  return {
    confirm, confirmLibrary, adopt,
    reset() { generation++; library = null; confirmed = null; draft = createStimulusOrder(); edited = false; render(); },
    get document() { return confirmed ? structuredClone(confirmed) : null; },
    get active() { return edited || Boolean(confirmed); },
    get pending() { return edited || Boolean(library && !confirmed); },
    async download(format) {
      if (busy) return;
      busy = true; render();
      try {
        if (!library || !["csv", "xlsx"].includes(format)) throw new Error("Confirm the video library before downloading.");
        const verified = await validateVideoLibrary(library);
        const bytes = format === "csv" ? new TextEncoder().encode(videoLibraryCsv(verified)) : videoLibraryWorkbook(verified);
        await operate("export-library", { format, bytes, librarySha256: verified.integritySha256 });
        report(`Video library ${format.toUpperCase()} export ready.`);
      } catch (error) { report(error.message, true); }
      finally { busy = false; render(); }
    },
    destroy() { generation++; host?.removeEventListener("input", onInput); host?.removeEventListener("change", onEdit); host?.removeEventListener("paste", onPaste); host?.removeEventListener("click", onClick); },
  };
}
