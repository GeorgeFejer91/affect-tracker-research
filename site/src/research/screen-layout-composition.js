import { projectVideoDisplayGeometryV1 } from "./video-catalogue-contribution.js";
import { projectWorkspaceVideoCatalogueSnapshotV1 } from "./workspace-contribution.js";

/** One connection after all owning controllers exist; no handlers inspect
 * neighbouring DOM fields or duplicate media/animation policy. */
export function connectScreenLayoutProducers(controller) {
  const disconnect = [
    controller.subscribeWorkspaceContributionChanges(() => { void controller.refreshScreenLayoutCatalogue(); }),
    controller.subscribeFeedbackChanges(() => { controller.refreshScreenLayoutFeedback(); }),
  ];
  void controller.connectScreenLayoutDependencies({
    getCatalogueSnapshot: () => controller.getWorkspaceContributionSnapshot(),
    projectSnapshot: projectWorkspaceVideoCatalogueSnapshotV1,
    projectCatalogue: projectVideoDisplayGeometryV1,
    getFeedbackLayoutSnapshot: side => controller.getFeedbackLayoutSnapshot(side),
  });
  return () => { for (const remove of disconnect) remove(); };
}
