// Kept as the stable master2/3 qualification entry point. SurveyJS now renders
// these forms; the shared harness tests their unchanged native wire contracts.
process.argv[5] ??= '2';
await import('./runner-surveyjs-ui.mjs');
