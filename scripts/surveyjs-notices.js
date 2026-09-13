import { readFile } from "node:fs/promises";

// Complete license text travels in the browser and embedded native JS bundle.
// These notices also remain directly readable in the Pages vendor directory.
export const surveyNotices = [
  "SurveyJS integration third-party notices\n\nSurveyJS Form Library 3.0.4: survey-core and survey-js-ui.\nCopyright (c) 2015-2026 Devsoft Baltic OÜ. Upstream MIT license follows.\nhttps://github.com/surveyjs/survey-library/tree/v3.0.4\n",
  await readFile(new URL("../docs/licenses/surveyjs-3.0.4-MIT.txt", import.meta.url), "utf8"),
  "\nDOMPurify 3.4.15, Copyright (c) 2015-present Cure53 and other contributors.\nDistributed under its Apache-2.0 option (upstream also offers MPL-2.0).\nhttps://github.com/cure53/DOMPurify/tree/3.4.15\n",
  await readFile(new URL("../docs/licenses/dompurify-3.4.15-APACHE.txt", import.meta.url), "utf8"),
  "\nBoa 0.22.0 (native validator), distributed under its MIT option.\nSource revision: 337a3668a0dc86dd401ea20906e782249a64a228\nhttps://github.com/boa-dev/boa/tree/337a3668a0dc86dd401ea20906e782249a64a228\n",
  await readFile(new URL("../docs/licenses/boa-0.22.0-MIT.txt", import.meta.url), "utf8"),
].join("\n").replaceAll("\r\n", "\n");
export const surveyNoticeBanner = `/*!\n${surveyNotices.replaceAll("*/", "* /")}\n*/`;
