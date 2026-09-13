import { commandFailure } from "./planner-authoring-contract.js";
import { NativeCatalogueFailure } from "./media-catalogue-error.js";

/** Compose existing owners, the native receipt transport and session publication.
 * No editor state, filesystem implementation or recipe compiler lives here. */
export function createPlannerCore9Composition(host) {
  return async function prepare(operation, args, context) {
    const native = host.nativeEffects();
    if (!native) commandFailure("operation_unavailable", "The native Planner transport is not connected.");
    const effect = (action, publication) => native.execute(context.request, action, publication);
    const workspaceId = () => {
      const id = host.nativeWorkspace()?.getWorkspaceId();
      if (!id) commandFailure("workspace_required", "Select the work directory first.", "P1");
      return id;
    };
    if (operation === "saveRecipe") {
      const prepared = await host.prepareSave(context);
      return { isCurrent: prepared.isCurrent, async dispatch(publication) {
        let basename = null;
        const result = await prepared.dispatch({ ...publication,
          write: async document => {
            const saved = await effect({ type: "writeRecipe", grantId: args.directory, sourceText: document.canonicalSourceText }, publication);
            basename = saved.basename; return saved.receipt;
          },
        });
        return { ...result, basename };
      } };
    }
    if (operation === "confirmSegment") {
      const prepared = await host.prepareConfirmation(args.segment, context);
      return { isCurrent: prepared.isCurrent, async dispatch({ publish }) {
        publish(prepared.commit, prepared.afterCommit);
        return { segment: args.segment, confirmed: true };
      } };
    }
    if (operation === "saveQuestionnaire") {
      const prepared = await host.prepareQuestionnaireSave(args.questionnaireId, context);
      const id = workspaceId();
      return { isCurrent: prepared.isCurrent, async dispatch(publication) {
        const receipt = await effect({ type: "storeQuestionnaire", workspaceId: id, ...prepared.storage }, publication);
        publication.publish(() => prepared.commit(receipt), prepared.afterCommit);
        return { questionnaireId: args.questionnaireId, sourceReceipt: receipt };
      } };
    }
    return { isCurrent: context.isCurrent, async dispatch(publication) {
      if (operation === "openRecipe") {
        const source = await effect({ type: "readRecipe", grantId: args.path }, publication);
        const prepared = await host.prepareOpen(source.sourceText, { ...context, isCurrent: publication.isCurrent });
        await prepared.applyViaPublication(publication);
        publication.finish({ sourceSha256: prepared.document.canonicalSourceByteSha256, version: prepared.document.recipe.version });
        return;
      }
      if (operation === "importQuestionnaire") {
        const source = await effect({ type: "readQuestionnaire", grantId: args.path }, publication);
        const prepared = await host.prepareQuestionnaireImport(source, args, { ...context, isCurrent: publication.isCurrent });
        publication.publish(prepared.commit, prepared.afterCommit);
        return { questionnaireId: prepared.questionnaireId, sourceSha256: source.sha256 };
      }
      const bridge = host.nativeWorkspace();
      if (!bridge) commandFailure("operation_unavailable", "Native workspace publication is not connected.", "P1");
      let prepared, app;
      if (operation === "selectWorkspace") {
        const receipt = await effect({ type: operation, grantId: args.directory }, publication);
        prepared = bridge.prepareWorkspace(receipt, publication);
        app = await host.prepareWorkspace(prepared.projection, publication);
      } else {
        const id = workspaceId();
        const action = { type: operation, workspaceId: id };
        if (operation === "importVideos") {
          if (!Array.isArray(args.paths) || args.paths.length !== 1) commandFailure("invalid_grant", "Native video selection needs one opaque grant.");
          action.grantId = args.paths[0];
        }
        else if (operation === "importVideoFolder") action.grantId = args.directory;
        else if (operation !== "rescanVideoLibrary") commandFailure("unknown_operation", "Unregistered Planner operation.");
        const receipt = await effect(action, publication);
        let phase = "bridgePreparation";
        try {
          prepared = await bridge.prepareCatalogue(receipt, publication);
          phase = "appProjection";
          app = await host.prepareCatalogue(prepared.projection, publication);
        } catch (error) {
          const diagnostic = error instanceof NativeCatalogueFailure ? error : new NativeCatalogueFailure(phase, error);
          commandFailure("native_failed", diagnostic.message, "P1.media.catalogue");
        }
      }
      if (!prepared.isCurrent() || !app.isCurrent()) commandFailure("stale_revision", "Workspace preparation changed.");
      publication.publish(() => { prepared.commit(); app.commit(); }, app.afterCommit);
      return { workspaceId: bridge.getWorkspaceId(), ...app.result };
    } };
  };
}
