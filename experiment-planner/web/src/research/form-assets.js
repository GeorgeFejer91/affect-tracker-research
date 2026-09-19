import en from "../../assets/questionnaires/demographics/en.json" with { type: "json" };
import de from "../../assets/questionnaires/demographics/de.json" with { type: "json" };
import { verifyFormDefinitionV1, validateFormDefinitionV1 } from "./form-definition.js";
const source = { en, de };
const hashes = { en: "0e2432c8ab25ae487679e8326b32ae9695b4d92b778077396129a7a5a5f32c76", de: "96dbcaae0a354dc828ab92708d0aeecda4cf4d048de102609224be62ae7ab117" };
export function demographicsFormDraft(language) {
  if (!Object.hasOwn(source, language)) throw new TypeError("Demographics is supplied in English and German; author an explicit form for other languages.");
  const d = validateFormDefinitionV1(source[language]);
  if (d.definitionSha256 !== hashes[language] || d.questionnaireId !== `demographics-${language}` || d.language !== language) throw new TypeError("Bundled demographics identity mismatch.");
  return d;
}
export async function loadDemographicsForm(language) { return verifyFormDefinitionV1(demographicsFormDraft(language)); }
