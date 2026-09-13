// Exercise standard SurveyJS keyboard interaction in the actual Runner app.
// Trusted Chrome input is necessary: synthetic keydown has no browser default.
// The former handwritten Enter-to-next-field behavior is no longer the renderer.
process.argv[5] ??= '2';
process.env.AFFECT_SURVEY_KEYBOARD = '1';
await import('./runner-surveyjs-ui.mjs');
