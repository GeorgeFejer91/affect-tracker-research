/** Shipped questionnaire choices, not a rights grant or runtime authority. */
export const PREBUILT_QUESTIONNAIRE_ASSETS = Object.freeze([
  { id: "maia-2-en", familyId: "maia-2", title: "MAIA-2", language: "en", languageLabel: "English", ready: true,
    description: "37 items · 6 answers · English wording, labels and recorded values included." },
  { id: "maia-2-de", familyId: "maia-2", title: "MAIA-2", language: "de", languageLabel: "Deutsch", ready: true,
    description: "37 items · 6 answers · German wording, labels and supplied reverse coding included." },
  { id: "tas-20-en", familyId: "tas-20", title: "TAS-20", language: "en", languageLabel: "English", ready: false,
    description: "Not shipped ready to use: redistribution permission is not verified. Paste or import your authorized version into a blank questionnaire." },
  { id: "tas-20-de", familyId: "tas-20", title: "TAS-20", language: "de", languageLabel: "Deutsch", ready: false,
    description: "Not shipped ready to use: authorized German wording and redistribution permission are still needed." },
].map(Object.freeze));

export function prebuiltQuestionnaireAvailability(asset, { languages, occupied = false, locked = false }) {
  if (!asset.ready) return { disabled: true, label: "Authorized asset needed" };
  if (locked) return { disabled: true, label: "Experiment locked" };
  if (!languages.includes(asset.language)) return { disabled: true, label: `Select ${asset.languageLabel} in Section 2 first` };
  if (occupied) return { disabled: true, label: "Already in your tables" };
  return { disabled: false, label: `Add ${asset.title} · ${asset.languageLabel}` };
}
