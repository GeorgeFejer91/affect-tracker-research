import { bootResearchUi } from "../../site/src/research/app.js?visual-qualification=2";
import { RESEARCH_UI_EVENTS } from "../../site/src/research/ui-contracts.js";

const FIXTURE_STATES = Object.freeze(["setup", "stimulus", "questionnaire", "interval", "complete"]);
const requestedState = new URLSearchParams(window.location.search).get("state") ?? "stimulus";

if (!FIXTURE_STATES.includes(requestedState)) {
  throw new TypeError(`Unknown visual fixture state ${requestedState}.`);
}

const root = bootResearchUi({ surface: "browser" });
if (!(root instanceof HTMLElement)) throw new Error("Research UI fixture could not mount.");

root.dataset.qualificationFixture = "visual-projection-only";
root.researchUi.setCapabilities({
  directoryPermission: true,
  indexedDbReady: true,
  timingWorkerReady: true,
  lslReady: false,
  manifestReady: true,
  storageReady: true,
  repositoryAssetsReady: true,
  nativePlaybackReady: true,
  nativeInputReady: true,
  nativeInputPresetReady: true,
});

function dispatch(type, detail) {
  root.dispatchEvent(new CustomEvent(type, { bubbles: true, detail: Object.freeze(detail) }));
}

function startFixtureRun() {
  dispatch(RESEARCH_UI_EVENTS.runStarted, {
    participantId: "P014",
    sessionStem: "P014_EF_A27_GW_HR_20260910T143012482Z_R01",
  });
}

async function waitFor(selector) {
  for (let frame = 0; frame < 120; frame += 1) {
    const found = root.querySelector(selector);
    if (found) return found;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  throw new Error(`Visual fixture timed out waiting for ${selector}.`);
}

async function showQuestionnaire() {
  root.researchUi.openSetupSection("questionnaires");
  const add = await waitFor('[data-bundled-questionnaire="vr-exp-en"]');
  add.click();
  const module = await waitFor("#questionnaire-module-list [data-module-id]");
  startFixtureRun();
  dispatch(RESEARCH_UI_EVENTS.questionnaireStatus, {
    active: true,
    moduleId: module.dataset.moduleId,
    protocolStepPosition: 0,
    itemIndex: 0,
    answers: {},
  });
}

if (requestedState === "setup") {
  root.researchUi.openSetupSection("review");
} else if (requestedState === "questionnaire") {
  await showQuestionnaire();
} else {
  startFixtureRun();
  if (requestedState === "stimulus") {
    dispatch(RESEARCH_UI_EVENTS.runStatus, {
      stimulus: "Calm landscape · complete video 1 of 2",
      timing: "130 Hz · sequence 018742",
      write: "Journal durable · 18,742 rows",
      lsl: "Off",
      x: 0.31,
      y: -0.22,
      ratingInputActive: true,
      pauseAvailable: true,
      paused: false,
    });
  }
  if (requestedState === "interval") {
    dispatch(RESEARCH_UI_EVENTS.runStatus, {
      stimulus: "Between complete videos",
      timing: "Sampling stopped · rating neutral",
      write: "Safe boundary committed",
      lsl: "Off",
      x: 0,
      y: 0,
      ratingInputActive: false,
      pauseAvailable: false,
      transitionActive: true,
      transitionMode: "continueWhenReady",
      transitionMessage: "Video complete. Sampling is stopped and the rating is neutral.",
    });
  }
  if (requestedState === "complete") {
    dispatch(RESEARCH_UI_EVENTS.runComplete, {
      status: "completed",
      participant: "P014",
      attempt: "R01",
      samples: "37,484",
      questionnaires: "2 complete",
      output: "outputs/affect-validation/P014/P014_EF_A27_GW_HR_20260910T143012482Z_R01/",
    });
  }
}

document.documentElement.dataset.visualFixtureReady = requestedState;
