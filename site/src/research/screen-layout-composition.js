import { projectVideoDisplayGeometry } from "./video-catalogue-contribution.js";
import { projectWorkspaceVideoCatalogueSnapshot } from "./workspace-contribution.js";

/** One connection after all owning controllers exist; no handlers inspect
 * neighbouring DOM fields or duplicate media/animation policy. */
export function connectScreenLayoutProducers(controller) {
  const disconnect = [
    controller.subscribeWorkspaceContributionChanges(() => { void controller.refreshScreenLayoutCatalogue(); }),
    controller.subscribeFeedbackChanges(() => { controller.refreshScreenLayoutFeedback(); }),
  ];
  void controller.connectScreenLayoutDependencies({
    getCatalogueSnapshot: () => controller.getWorkspaceContributionSnapshot(),
    projectSnapshot: projectWorkspaceVideoCatalogueSnapshot,
    projectCatalogue: projectVideoDisplayGeometry,
    getFeedbackLayoutSnapshot: side => controller.getFeedbackLayoutSnapshot(side),
    getFeedbackSnapshot: () => controller.getFeedbackContributionSnapshot(),
  });
  return () => { for (const remove of disconnect) remove(); };
}
