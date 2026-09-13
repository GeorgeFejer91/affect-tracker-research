import { surveyNotices } from "./surveyjs-notices.js";

export function surveyNoticesPlugin() {
  return { name: "surveyjs-license-notices", generateBundle() {
    this.emitFile({ type: "asset", fileName: "surveyjs-notices.txt", source: surveyNotices });
  } };
}
