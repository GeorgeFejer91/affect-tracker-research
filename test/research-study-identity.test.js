import assert from "node:assert/strict";
import test from "node:test";

import {
  createStudyIdentityV1,
  validateStudyIdentityV1,
} from "../site/src/research/study-identity.js";

test("P1 study identity is editable strict content independent of filesystem authority", () => {
  const identity = createStudyIdentityV1({ id: "video-affect-study", title: "Video Affect Study" });
  assert.deepEqual(identity, {
    schema: "affect-research-study-identity",
    version: 1,
    id: "video-affect-study",
    title: "Video Affect Study",
  });
  assert.deepEqual(validateStudyIdentityV1(identity), identity);
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(Object.hasOwn(identity, "path"), false);
  assert.equal(Object.hasOwn(identity, "permission"), false);
});

test("P1 study identity rejects unsafe IDs, untrimmed titles and extra authority", () => {
  for (const value of [
    { id: "Uppercase", title: "Study" },
    { id: "-leading", title: "Study" },
    { id: "study", title: " Study " },
    { id: "study", title: "" },
  ]) assert.throws(() => createStudyIdentityV1(value));
  assert.throws(() => validateStudyIdentityV1({
    ...createStudyIdentityV1({ id: "study", title: "Study" }),
    workspacePath: "C:/research",
  }));
});
