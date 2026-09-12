import { parsePlannerRecipeV1 } from "./planner-recipe.js";

const ORDER = Object.freeze(["P1", "P2", "P5", "P3", "P4", "P6", "policy", "presentationTarget"]);

export class PlannerRecipeRestoreError extends Error {
  constructor(cause, completed, attempted = completed) {
    super(completed.length ? "Recipe reopening stopped after some fields were restored. Review the current fields; the file has not been adopted as an unchanged saved recipe."
      : "The recipe could not be restored. No saved-file adoption was completed.", { cause });
    this.name = "PlannerRecipeRestoreError";
    this.completed = Object.freeze([...completed]);
    this.attempted = Object.freeze([...attempted]);
    this.partial = completed.length > 0;
  }
}

/** Validate every domain/reference/hash before permitting any owner mutation.
 * The caller guard binds only the Open's researcher-edit/operation/disposal
 * lifetime, not acceptance generations which are intentionally cleared on Open. */
export async function preparePlannerRecipeReopenV1(sourceText, { isCurrent }) {
  return preparePlannerRecipeReopen(sourceText, { isCurrent, parseDocument: parsePlannerRecipeV1 });
}

/** Explicit supported-reader seam. The injected reader must strictly validate
 * the entire source, all owner payloads and integrity before returning a frozen
 * document. No schema/version heuristics or validation fallback belong here. */
export async function preparePlannerRecipeReopen(sourceText, { isCurrent, parseDocument }) {
  if (typeof parseDocument !== "function") throw new TypeError("Recipe reopen requires an explicit validated document reader.");
  if (typeof isCurrent !== "function") throw new TypeError("Recipe reopen requires the caller's edit/operation/disposal guard.");
  let stale = false;
  const current = () => {
    try { if (isCurrent() !== true) stale = true; } catch { stale = true; }
    return !stale;
  };
  const requireCurrent = () => { if (!current()) throw new Error("A newer edit, Open or teardown replaced this recipe restoration."); };
  requireCurrent();
  if (typeof sourceText !== "string") throw new TypeError("Recipe reopening requires canonical source text.");
  const document = await parseDocument(new TextEncoder().encode(sourceText));
  requireCurrent();
  let used = false;
  const contextFor = current => Object.freeze({ workspace: document.recipe.segments.P1,
    feedback: document.recipe.segments.P5, presentationTarget: document.recipe.presentationTarget, isCurrent: current });
  const valueFor = name => structuredClone(name === "policy" ? document.recipe.policy : name === "presentationTarget"
    ? document.recipe.presentationTarget : document.recipe.segments[name]);
  return Object.freeze({ document, isCurrent: current,
    /** Adapters call their domain's guarded content-only restore. For P3/P4,
     * obtain actual current dependencies at invocation, after P1/P5 restore;
     * saved declarations are context, never fabricated ready snapshots.
     * begin synchronously revokes prior source-save eligibility/acceptance.
     * Only the successful return permits immutable source adoption. */
    async apply(owners) {
      if (used) throw new Error("Prepare a new reopen operation before applying this recipe again.");
      for (const name of ["begin", ...ORDER]) if (typeof owners?.[name] !== "function") {
        throw new TypeError(`Recipe restoration requires the ${name} owner adapter.`);
      }
      requireCurrent(); used = true;
      const completed = [];
      try {
        const beginning = owners.begin();
        if (beginning && typeof beginning.then === "function") throw new TypeError("Recipe restoration begin must be synchronous.");
        const context = contextFor(current);
        for (const name of ORDER) {
          requireCurrent();
          const result = await owners[name](valueFor(name), context);
          if (result !== true && (!result || typeof result !== "object")) throw new Error(`${name} did not complete its guarded content restoration.`);
          completed.push(name);
          requireCurrent();
        }
        return document;
      } catch (error) {
        // Do not roll back over a newer researcher edit. Report completed
        // portions and deny loaded-source adoption/unchanged-file reexport.
        throw new PlannerRecipeRestoreError(error, completed);
      }
    },
    /** CLI publication path. Domain adapters prepare without changing state and
     * return {isCurrent?, commit, afterCommit?}; only commit runs inside the
     * session's synchronous publication boundary. begin/adoptDocument are state
     * hooks; afterBegin/afterAdoptDocument are optional synchronous projections.
     * The caller retains native read receipts and calls finish after success. */
    async applyViaPublication(owners, publication) {
      if (used) throw new Error("Prepare a new reopen operation before applying this recipe again.");
      for (const name of ORDER) if (typeof owners?.[name] !== "function") {
        throw new TypeError(`Recipe restoration requires the ${name} preparation adapter.`);
      }
      for (const name of ["begin", "adoptDocument"]) synchronousHook(owners?.[name], name);
      for (const name of ["afterBegin", "afterAdoptDocument"]) if (owners[name] !== undefined) synchronousHook(owners[name], name);
      synchronousHook(publication?.publishStep, "publishStep");
      if (typeof publication.isCurrent !== "function") throw new TypeError("Recipe publication requires its current-operation guard.");
      let invalidated = false;
      const publicationCurrent = () => {
        try { if (!current() || publication.isCurrent() !== true) invalidated = true; }
        catch { invalidated = true; }
        return !invalidated;
      };
      const check = () => { if (!publicationCurrent()) throw new Error("A newer edit, Open or teardown replaced this recipe restoration."); };
      check(); used = true;
      const attempted = [], completed = [], context = contextFor(publicationCurrent);
      const publish = (name, commit, afterCommit, candidateCurrent = () => true) => {
        synchronousHook(commit, `${name} commit`);
        if (afterCommit !== undefined) synchronousHook(afterCommit, `${name} afterCommit`);
        const before = () => {
          check();
          if (candidateCurrent() !== true) throw new Error(`${name} changed while its restoration was being prepared.`);
        };
        before();
        let invoked = false;
        runSynchronous(() => publication.publishStep(name, () => {
          if (invoked) throw new TypeError("A recipe publication boundary cannot be invoked twice.");
          invoked = true; attempted.push(name); before();
          runSynchronous(commit);
          completed.push(name);
        }, afterCommit));
        if (!invoked) throw new TypeError("Recipe publication did not invoke its state boundary.");
        // A successful commit may itself invalidate its old candidate guard.
        // Only the command/edit lifetime remains applicable after publication.
        check();
      };
      try {
        publish("begin", () => runSynchronous(owners.begin), owners.afterBegin);
        for (const name of ORDER) {
          check();
          const candidate = await owners[name](valueFor(name), context);
          check();
          if (!candidate || typeof candidate !== "object"
            || (candidate.isCurrent !== undefined && typeof candidate.isCurrent !== "function")) {
            throw new TypeError(`${name} returned no guarded preparation.`);
          }
          synchronousHook(candidate.commit, `${name} commit`);
          if (candidate.afterCommit !== undefined) synchronousHook(candidate.afterCommit, `${name} afterCommit`);
          publish(name, () => candidate.commit(), candidate.afterCommit === undefined ? undefined : () => candidate.afterCommit(),
            candidate.isCurrent === undefined ? undefined : () => candidate.isCurrent());
        }
        publish("adoptDocument", () => owners.adoptDocument(document), owners.afterAdoptDocument);
        return document;
      } catch (error) {
        throw new PlannerRecipeRestoreError(error, completed, attempted);
      }
    },
  });
}

function synchronousHook(hook, name) {
  if (typeof hook !== "function" || Object.prototype.toString.call(hook) === "[object AsyncFunction]") {
    throw new TypeError(`${name} must be a synchronous function.`);
  }
}
function runSynchronous(hook) {
  const result = hook();
  if (result && typeof result.then === "function") {
    Promise.resolve(result).catch(() => {});
    throw new TypeError("Recipe publication returned asynchronous work; inspect the applied state.");
  }
  return result;
}
