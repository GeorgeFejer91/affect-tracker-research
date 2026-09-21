import { createBoundedTextFitter } from "./text-fit.js";

const HIDDEN_ATTRIBUTE = "data-ledger-page-hidden";
const FIT_SCALE_ATTRIBUTE = "data-ledger-fit-scale";
const TEXTAREA_HEIGHT_ATTRIBUTE = "data-ledger-fit-height";

export function packLedgerPageItems(items, fits) {
  const pages = [];
  let page = [];
  for (const item of items) {
    const candidate = [...page, item];
    if (page.length && !fits(candidate)) {
      pages.push(page);
      page = [item];
    } else {
      page = candidate;
    }
  }
  if (page.length) pages.push(page);
  return pages;
}

function collectItems(container) {
  const items = [];
  for (const child of container.children) {
    if (child.matches("dialog,[hidden],input[type=hidden],[data-ledger-page-ignore]")) continue;
    if (child.matches("[data-ledger-page-spread]")) items.push(...collectItems(child));
    else items.push(child);
  }
  return items;
}

function setVisible(item, visible) {
  item.toggleAttribute(HIDDEN_ATTRIBUTE, !visible);
  if (visible) {
    if (item.dataset.ledgerPageInert === "true") item.inert = false;
    delete item.dataset.ledgerPageInert;
  } else {
    if (!item.inert) item.dataset.ledgerPageInert = "true";
    item.inert = true;
  }
}

function resetItemScale(item) {
  item.style.removeProperty("zoom");
  item.removeAttribute(FIT_SCALE_ATTRIBUTE);
}

function expandTextareas(section, view, layouts) {
  for (const textarea of section.querySelectorAll("textarea")) {
    if (!(textarea instanceof view.HTMLTextAreaElement)) continue;
    const key = `${textarea.clientWidth}:${textarea.value}`;
    if (layouts.get(textarea) === key) continue;
    textarea.style.height = "0px";
    const height = Math.max(textarea.scrollHeight, 48);
    const next = `${height}px`;
    if (textarea.style.height !== next) textarea.style.height = next;
    textarea.setAttribute(TEXTAREA_HEIGHT_ATTRIBUTE, "");
    layouts.set(textarea, key);
  }
}

function fitSingleItem(flow, items) {
  if (items.length !== 1 || flow.clientWidth <= 0 || flow.clientHeight <= 0) return 1;
  const item = items[0];
  const widthScale = flow.scrollWidth > flow.clientWidth ? flow.clientWidth / flow.scrollWidth : 1;
  const heightScale = flow.scrollHeight > flow.clientHeight ? flow.clientHeight / flow.scrollHeight : 1;
  const scale = Math.min(1, widthScale, heightScale);
  if (scale >= 1) return 1;
  const bounded = Math.max(0.001, scale * 0.995);
  item.style.setProperty("zoom", String(bounded));
  item.setAttribute(FIT_SCALE_ATTRIBUTE, bounded.toFixed(4));
  return bounded;
}

export function createLedgerPageLayout(root) {
  const view = root.ownerDocument.defaultView;
  if (root.dataset.plannerInterface !== "ledger" || typeof view.ResizeObserver !== "function") {
    return Object.freeze({ refresh() {}, destroy() {} });
  }

  const textFitter = createBoundedTextFitter(root);
  const selectedPages = new WeakMap();
  const textareaLayouts = new WeakMap();
  let frame = 0;
  let destroyed = false;

  function renderPage(section, requestedPage = selectedPages.get(section) ?? 0) {
    const flow = section.querySelector("[data-ledger-page-flow]");
    const navigation = section.querySelector("[data-ledger-pagination]");
    if (!(flow instanceof view.HTMLElement) || !(navigation instanceof view.HTMLElement) || section.hidden) return;
    const items = collectItems(flow);
    if (!items.length) return;

    for (const item of items) {
      resetItemScale(item);
      setVisible(item, true);
    }
    expandTextareas(section, view, textareaLayouts);
    const focusedItem = items.findIndex((item) => item.contains(root.ownerDocument.activeElement));
    const fits = (candidate) => {
      const visible = new Set(candidate);
      for (const item of items) setVisible(item, visible.has(item));
      return flow.scrollWidth <= flow.clientWidth + 1 && flow.scrollHeight <= flow.clientHeight + 1;
    };
    const pages = packLedgerPageItems(items, fits);
    let pageIndex = Math.max(0, Math.min(pages.length - 1, requestedPage));
    if (focusedItem >= 0) {
      const focusedPage = pages.findIndex((page) => page.includes(items[focusedItem]));
      if (focusedPage >= 0) pageIndex = focusedPage;
    }
    const current = pages[pageIndex] ?? items;
    const visible = new Set(current);
    for (const item of items) setVisible(item, visible.has(item));
    let currentFits = fits(current);
    const scale = currentFits ? 1 : fitSingleItem(flow, current);
    currentFits = flow.scrollWidth <= flow.clientWidth + 1 && flow.scrollHeight <= flow.clientHeight + 1;
    selectedPages.set(section, pageIndex);

    const previous = navigation.querySelector("[data-ledger-page-previous]");
    const next = navigation.querySelector("[data-ledger-page-next]");
    const status = navigation.querySelector("[data-ledger-page-status]");
    if (previous instanceof view.HTMLButtonElement) previous.disabled = pageIndex === 0;
    if (next instanceof view.HTMLButtonElement) next.disabled = pageIndex >= pages.length - 1;
    const statusText = `Page ${pageIndex + 1} of ${pages.length}`;
    if (status && status.textContent !== statusText) status.textContent = statusText;
    navigation.dataset.singlePage = String(pages.length === 1);
    section.dataset.ledgerPageCount = String(pages.length);
    section.dataset.ledgerPageNoFit = String(!currentFits);
    section.dataset.ledgerPageScale = scale.toFixed(4);
  }

  function flush() {
    frame = 0;
    if (destroyed) return;
    const openSection = root.querySelector(".ledger-page .setup-accordion-panel:not([hidden])")?.closest(".ledger-page");
    if (openSection instanceof view.HTMLElement) renderPage(openSection);
    textFitter.refresh();
  }

  function refresh() {
    if (!frame) frame = view.requestAnimationFrame(flush);
  }

  function onClick(event) {
    const button = event.target instanceof view.Element
      ? event.target.closest("[data-ledger-page-previous],[data-ledger-page-next]") : null;
    const section = button?.closest(".ledger-page");
    if (!(button instanceof view.HTMLButtonElement) || !(section instanceof view.HTMLElement)) return;
    const direction = button.hasAttribute("data-ledger-page-next") ? 1 : -1;
    renderPage(section, (selectedPages.get(section) ?? 0) + direction);
    button.focus();
  }

  const pane = root.querySelector(".setup-pane");
  const resizeObserver = new view.ResizeObserver(refresh);
  if (pane) resizeObserver.observe(pane);
  const mutationObserver = new view.MutationObserver(refresh);
  mutationObserver.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["hidden", "open", "aria-expanded"],
  });
  root.addEventListener("click", onClick);
  root.addEventListener("toggle", refresh, true);
  root.addEventListener("input", refresh);
  refresh();

  return Object.freeze({
    refresh,
    destroy() {
      destroyed = true;
      if (frame) view.cancelAnimationFrame(frame);
      root.removeEventListener("click", onClick);
      root.removeEventListener("toggle", refresh, true);
      root.removeEventListener("input", refresh);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      textFitter.destroy();
      for (const item of root.querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`)) setVisible(item, true);
      for (const item of root.querySelectorAll(`[${FIT_SCALE_ATTRIBUTE}]`)) resetItemScale(item);
      for (const textarea of root.querySelectorAll(`[${TEXTAREA_HEIGHT_ATTRIBUTE}]`)) {
        textarea.style.removeProperty("height");
        textarea.removeAttribute(TEXTAREA_HEIGHT_ATTRIBUTE);
      }
    },
  });
}
