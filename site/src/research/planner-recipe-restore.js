import { parsePlannerRecipeV1 } from "./planner-recipe.js";

const ORDER = Object.freeze(["P1", "P2", "P5", "P3", "P4", "P6", "policy", "presentationTarget"]);

export class PlannerRecipeRestoreError extends Error {
  constructor(cause, completed) {
    super(completed.length ? "Recipe reopening stopped after some fields were restored. Review the current fields; the file has not been adopted as an unchanged saved recipe."
      : "The recipe could not be restored. No saved-file adoption was completed.", { cause });
    this.name = "PlannerRecipeRestoreError";
    this.completed = Object.freeze([...completed]);
    this.partial = completed.length > 0;
  }
}

/** Validate every domain/reference/hash before permitting any owner mutation.
 * The caller guard binds only the Open's researcher-edit/operation/disposal
 * lifetime, not acceptance generations which are intentionally cleared on Open. */
export async function preparePlannerRecipeReopenV1(sourceText, { isCurrent }) {
  if (typeof isCurrent !== "function") throw new TypeError("Recipe reopen requires the caller's edit/operation/disposal guard.");
  let stale = false;
  const current = () => {
    try { if (isCurrent() !== true) stale = true; } catch { stale = true; }
    return !stale;
  };
  const requireCurrent = () => { if (!current()) throw new Error("A newer edit, Open or teardown replaced this recipe restoration."); };
  requireCurrent();
  if (typeof sourceText !== "string") throw new TypeError("Recipe reopening requires canonical source text.");
  const document = await parsePlannerRecipeV1(new TextEncoder().encode(sourceText));
  requireCurrent();
  let used = false;
  return Object.freeze({ document,
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
        const context = Object.freeze({ workspace: document.recipe.segments.P1,
          feedback: document.recipe.segments.P5, presentationTarget: document.recipe.presentationTarget, isCurrent: current });
        for (const name of ORDER) {
          requireCurrent();
          const value = name === "policy" ? document.recipe.policy : name === "presentationTarget"
            ? document.recipe.presentationTarget : document.recipe.segments[name];
          const result = await owners[name](structuredClone(value), context);
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
  });
}
