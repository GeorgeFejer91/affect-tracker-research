import { projectVideoDisplayGeometryV1 } from "./video-catalogue-contribution.js";

/** One connection after all owning controllers exist; no handlers inspect
 * neighbouring DOM fields or duplicate media/animation policy. */
export function connectScreenLayoutProducers(controller) {
  const disconnect = [
    controller.subscribeVideoCatalogueChanges(() => { void controller.refreshScreenLayoutCatalogue(); }),
    controller.subscribeFeedbackChanges(() => { controller.refreshScreenLayoutFeedback(); }),
  ];
  void controller.connectScreenLayoutDependencies({
    getCatalogueSnapshot: () => controller.getVideoCatalogueContributionSnapshot(),
    projectCatalogue: projectVideoDisplayGeometryV1,
    getFeedbackLayoutSnapshot: side => controller.getFeedbackLayoutSnapshot(side),
  });
  return () => { for (const remove of disconnect) remove(); };
}
