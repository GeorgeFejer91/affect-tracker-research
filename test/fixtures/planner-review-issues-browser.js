import { bootResearchUi } from "../../site/src/research/app.js";
import { PLANNER_SEGMENT_SECTIONS } from "../../site/src/research/planner-contributions.js";
import { renderPlannerContributionIssues } from "../../site/src/research/planner-issue-view.js";

// Actual default app and registered producers, with no injected issue/media data.
const checks = [], errors = [];
const check = (name, value) => { if (!value) throw Error(name); checks.push(name); };
const wait = () => new Promise(resolve => setTimeout(resolve, 400));
addEventListener("error", event => errors.push(event.message));
addEventListener("unhandledrejection", event => errors.push(String(event.reason)));

(async () => {
  const root = document.querySelector("main");
  root.id = "research-app"; root.dataset.researchSurface = "browser";
  bootResearchUi(); await wait();
  const ui = root.researchUi, q = selector => root.querySelector(selector);
  const openReview = async () => { if (ui.openSection !== "review") ui.openSetupSection("review"); await wait(); };
  await openReview();
  const container = q("#package-contribution-issues"), details = container.querySelector("details");
  const rows = container.querySelector(".package-issue-sections"), diagnostics = container.querySelector(".package-issue-diagnostics");
  const initial = ui.getPlannerContributionReview().issues;
  const distinct = new Set(initial.map(issue => JSON.stringify(issue)));
  check("actual incomplete state has repeated reasons", initial.length > new Set(initial.map(issue => issue.segment)).size);
  check("one compact row per affected section", rows.children.length === new Set(initial.map(issue => issue.segment)).size);
  check("every distinct issue remains in diagnostics", diagnostics.children.length === distinct.size);
  check("all issue codes and owning actions remain", initial.every(({ segment, code }) =>
    [...diagnostics.children].some(item => item.dataset.issueCode === code && item.firstElementChild.dataset.plannerSegment === segment)));
  check("researcher-facing section names replace internal IDs", !/\bP[1-6]\b/u.test(container.textContent));
  check("dependency detail names Workspace", [...diagnostics.children].some(item => item.dataset.issueCode === "dependency-stale" && item.textContent.includes("Workspace")));
  check("diagnostics are collapsed initially", !details.open && !diagnostics.firstElementChild.checkVisibility());
  check("compact rows are unboxed", [...rows.querySelectorAll("button")].every(button => getComputedStyle(button).borderTopWidth === "0px"));
  check("missing state still blocks save", q("#package-generate").disabled);

  // Preserve the native disclosure and active control across same/changed issues.
  details.open = true;
  const focused = diagnostics.querySelector("button"); focused.focus();
  renderPlannerContributionIssues(container, ui.getPlannerContributionReview().issues);
  check("unchanged background render retains exact focused node and open details", document.activeElement === focused && details.open);
  const enableXr = value => {
    q("[data-xr-enabled]").checked = value;
    q("[data-xr-enabled]").dispatchEvent(new Event("change", { bubbles: true }));
  };
  enableXr(true); await wait();
  check("real optional section edit adds its issues", rows.querySelector('[data-planner-segment="P6"]'));
  check("changed issue set retains the focused diagnostic and disclosure", details.open
    && diagnostics.contains(document.activeElement) && document.activeElement.textContent === focused.textContent);
  enableXr(false); await wait();
  check("optional exclusion removes only that section", !rows.querySelector('[data-planner-segment="P6"]') && diagnostics.children.length === distinct.size);

  const navigate = async (button, name) => {
    const owner = button.dataset.plannerSegment, section = PLANNER_SEGMENT_SECTIONS[owner];
    button.click(); await wait();
    check(name, ui.openSection === section && document.activeElement.closest(`[data-setup-section="${section}"]`));
    await openReview();
  };
  for (const button of [...rows.querySelectorAll("button")]) await navigate(button, `compact ${button.textContent} action opens and focuses its section`);
  for (const button of [...diagnostics.querySelectorAll("button")]) await navigate(button, `detail action opens and focuses ${button.textContent}`);
  check("full details remain expanded during section navigation", details.open);
  check("navigation cannot acknowledge a save", q("#package-generate").disabled && !ui.reviewedSetupSections.includes("review"));
  details.open = new URL(location.href).searchParams.get("expanded") === "true";
  await openReview();
  const pane = q(".setup-pane"), section = q('[data-setup-section="review"]');
  pane.scrollTop += section.getBoundingClientRect().top - pane.getBoundingClientRect().top;
  await wait();
  const compactHeight = rows.getBoundingClientRect().height;
  check("section rows remain compact", compactHeight <= 240);
  check("Review stays within the actual pane width", pane.scrollWidth <= pane.clientWidth + 1 && container.scrollWidth <= container.clientWidth + 1);
  const ids = [...root.querySelectorAll("[id]")].map(element => element.id);
  check("no duplicate IDs", new Set(ids).size === ids.length);
  check("no controller errors", errors.length === 0);
  document.querySelector("#receipt").textContent = JSON.stringify({ passed: true, checks, errors,
    viewport: { width: innerWidth, height: innerHeight }, paneWidth: pane.clientWidth,
    compactHeight, issueCount: distinct.size, groupCount: rows.children.length, detailsOpen: details.open,
    evidence: "Actual default app/owner missing state; real XR toggle and issue navigation. No injected warnings, media or acceptance. No native/physical qualification." });
})().catch(error => { document.querySelector("#receipt").textContent = JSON.stringify({ passed: false, error: String(error.stack), checks, errors }); });
