// Window presentation owns no experiment timing, answers, acquisition or files.
export function createRunnerPresentation(root, { invoke, windowObject, isActive }) {
  const query = id => root.querySelector(`#${id}`);
  const shell = root.querySelector(".runner-shell");
  let presenting = false;
  const paint = () => new Promise(resolve => windowObject.requestAnimationFrame(() => windowObject.requestAnimationFrame(resolve)));
  function showPage(page) {
    query("runner-preparation").hidden = page !== "preparation";
    query("runner-stage").hidden = page !== "run";
    query("runner-questionnaire").hidden = page !== "questionnaire";
    query("runner-session-menu").hidden = page !== "run";
  }
  function launcher() {
    presenting = false;
    shell.classList.remove("is-presenting");
    query("runner-launcher").hidden = false;
    query("runner-participant-view").hidden = true;
    query("runner-launch").focus();
  }
  return Object.freeze({
    get active() { return presenting; },
    showPage,
    async enter() {
      root.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
      query("runner-launcher").hidden = true;
      query("runner-participant-view").hidden = false;
      shell.classList.add("is-presenting");
      // Paint black before requesting fullscreen. Participant details appear only after it succeeds.
      for (const id of ["runner-preparation", "runner-stage", "runner-questionnaire", "runner-session-menu"]) query(id).hidden = true;
      await paint();
      try {
        await invoke("research_runner_fullscreen", { fullscreen: true });
        await paint();
        presenting = true;
        showPage("preparation"); query("runner-preparation-title").focus();
      } catch (error) {
        // A rejected window request is never represented as a fullscreen session.
        await invoke("research_runner_fullscreen", { fullscreen: false }).catch(() => {});
        launcher(); throw error;
      }
    },
    async leave() {
      if (isActive()) throw new Error("Finish or stop the active attempt before returning to the launcher.");
      if (presenting) await invoke("research_runner_fullscreen", { fullscreen: false });
      root.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
      launcher();
    },
  });
}
