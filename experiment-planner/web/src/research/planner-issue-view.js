const SECTION_LABELS = Object.freeze({
  P1: "Workspace", P2: "Questionnaires", P3: "Stimulus order",
  P4: "Screen layout", P5: "Flubber & controls", P6: "VR screen layout",
});
const ISSUE_SUMMARIES = Object.freeze({
  "contribution-pending": "Confirm edits",
  "successor-required": "Recipe format unavailable",
  "contribution-invalid": "Review invalid settings",
  "dependency-stale": "Review dependencies",
  "dependency-cycle": "Review dependencies",
  "acceptance-missing": "Confirm section",
  "acceptance-stale": "Confirm changed settings",
  "acceptance-invalid": "Review invalid settings",
});

/** Presentation only: keep each distinct diagnostic and its owning section.
 * Grouping never changes the registry's blocking issues or acceptance state. */
export function groupPlannerContributionIssues(issues) {
  const groups = new Map();
  for (const { segment, code, message } of issues) {
    if (!groups.has(segment)) groups.set(segment, {
      segment, label: SECTION_LABELS[segment] ?? segment, issues: [],
    });
    const group = groups.get(segment);
    if (group.issues.some((issue) => issue.code === code && issue.sourceMessage === message)) continue;
    const text = code === "successor-required"
      ? "These settings cannot be saved in the current recipe format."
      : message.replace(new RegExp(`^${segment}:\\s*`, "u"), "")
        .replace(/\bP[1-6]\b/gu, (id) => SECTION_LABELS[id]);
    group.issues.push({ code, sourceMessage: message, message: text });
  }
  return [...groups.values()].map((group) => ({
    ...group,
    summary: [...new Set(group.issues.map(({ code }) => ISSUE_SUMMARIES[code] ?? "Review issue"))].join(" · "),
  }));
}

const rendered = new WeakMap();

export function renderPlannerContributionIssues(container, issues) {
  if (!container) return;
  const groups = groupPlannerContributionIssues(issues);
  const fingerprint = JSON.stringify(groups);
  // Background readiness refreshes must not replace the active navigation control.
  if (rendered.get(container) === fingerprint) return;
  const document = container.ownerDocument;
  const rows = container.querySelector(".package-issue-sections");
  const details = container.querySelector("details");
  const diagnostics = container.querySelector(".package-issue-diagnostics");
  const focused = container.contains(document.activeElement) ? document.activeElement : null;
  const focusedSegment = focused?.dataset.plannerSegment;
  const inDiagnostics = focused && diagnostics.contains(focused);
  const focusedMessage = inDiagnostics ? focused.textContent : null;
  const buttonFor = (segment, text) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "package-issue-link";
    button.dataset.plannerSegment = segment;
    button.textContent = text;
    return button;
  };
  rows.replaceChildren(...groups.map(({ segment, label, summary }, index) => {
    const item = document.createElement("li");
    const button = buttonFor(segment, label);
    const description = document.createElement("span");
    description.id = `package-issue-summary-${index}`;
    description.textContent = summary;
    button.setAttribute("aria-describedby", description.id);
    item.append(button, description);
    return item;
  }));
  diagnostics.replaceChildren(...groups.flatMap(({ segment, label, issues: entries }) => entries.map(({ code, message }) => {
    const item = document.createElement("li");
    item.dataset.issueCode = code;
    item.append(buttonFor(segment, `${label}: ${message}`));
    return item;
  })));
  const count = diagnostics.children.length;
  details.querySelector("summary").textContent = `Issue details (${count})`;
  container.hidden = count === 0;
  rendered.set(container, fingerprint);
  if (focusedSegment && count > 0) {
    const buttons = [...(inDiagnostics ? diagnostics : rows).querySelectorAll("button")];
    const replacement = buttons.find((button) => button.dataset.plannerSegment === focusedSegment
      && (!inDiagnostics || button.textContent === focusedMessage))
      ?? buttons.find((button) => button.dataset.plannerSegment === focusedSegment);
    (replacement ?? details.querySelector("summary")).focus({ preventScroll: true });
  }
}
