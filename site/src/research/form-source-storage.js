import { canonicalJson, sha256Hex } from "./canonical.js";
import { verifyFormDefinitionV1 } from "./form-definition.js";
import { questionnaireFamilyId } from "./questionnaire-assets.js";

/** Construct the existing storage command from exact typed JSON source bytes.
 * Never invent a CSV authoring receipt or treat definition hash as file hash. */
export async function prepareFormSourceStorage(sourceBytes, input) {
  if (!(sourceBytes instanceof Uint8Array)) throw new TypeError("Typed form source bytes are required.");
  const bytes = sourceBytes.slice(), definition = await verifyFormDefinitionV1(structuredClone(input));
  const expected = new TextEncoder().encode(`${canonicalJson(definition)}\n`);
  if (bytes.length !== expected.length || bytes.some((byte, index) => byte !== expected[index])) {
    throw new TypeError("Typed form storage requires its exact canonical JSON and one LF.");
  }
  return { familyId: questionnaireFamilyId(definition), languageTag: definition.language,
    format: "json", sourceSha256: await sha256Hex(bytes), bytes };
}
