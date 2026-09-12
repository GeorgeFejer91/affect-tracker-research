import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createStudyIdentityV1 } from "../site/src/research/study-identity.js";
import {
  createWorkspaceContributionV1,
  validateWorkspaceContributionV1,
} from "../site/src/research/workspace-contribution.js";

const fixtureUrl = new URL("./fixtures/research-video-catalogue-contribution-v1.json", import.meta.url);

test("P1 workspace contribution combines editable study content and fixed relative layout without filesystem authority", async () => {
  const videoCatalogue = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const contribution = createWorkspaceContributionV1({
    study: createStudyIdentityV1({ id: "video-affect-study", title: "Video Affect Study" }),
    videoCatalogue,
  });
  assert.deepEqual(contribution.workspaceLayout, {
    assetRoot: "assets",
    videoLibrary: "assets/stimuli",
    projectFile: "experiment.package.json",
  });
  assert.equal(Object.hasOwn(contribution.workspaceLayout, "absolutePath"), false);
  assert.equal(Object.hasOwn(contribution.workspaceLayout, "permission"), false);
  assert.deepEqual(await validateWorkspaceContributionV1(contribution), contribution);
});

test("P1 workspace contribution rejects altered layout and invalid nested catalogues", async () => {
  const videoCatalogue = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const valid = createWorkspaceContributionV1({
    study: createStudyIdentityV1({ id: "study", title: "Study" }),
    videoCatalogue,
  });
  await assert.rejects(validateWorkspaceContributionV1({
    ...valid,
    workspaceLayout: { ...valid.workspaceLayout, assetRoot: "C:/research/assets" },
  }));
  await assert.rejects(validateWorkspaceContributionV1({
    ...valid,
    videoCatalogue: { ...valid.videoCatalogue, revision: 2 },
  }));
});
