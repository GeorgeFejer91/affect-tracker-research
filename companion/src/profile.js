export const PROFILE = "affect-runner-professor-v1";
export const CAPABILITIES = Object.freeze(["command-ack", "latest-state", "state-snapshot"]);
export const SCOPES = Object.freeze(["runner.observe", "runner.operate", "runner.video"]);
export const ACTIONS = Object.freeze(["start", "pause", "resume", "stop"]);
export const COMPANION_URL = "https://georgefejer91.github.io/affect-tracker-research/runner/professor/";
const token = /^[A-Za-z0-9_]{8,96}$/u;
export function parseInvitation(fragment) {
  if (typeof fragment !== "string" || fragment.length > 1024) throw new Error("Invalid invitation.");
  const params = new URLSearchParams(fragment.replace(/^#/u, ""));
  if ([...params.keys()].sort().join(",") !== "room,secret,session,stream") throw new Error("Invalid invitation.");
  const invitation = Object.fromEntries(params);
  if (!token.test(invitation.room) || !token.test(invitation.session) || !token.test(invitation.stream)
    || !/^brsp_target_/u.test(invitation.stream) || !/^[a-f0-9]{64}$/u.test(invitation.secret)) throw new Error("Invalid invitation.");
  return Object.freeze(invitation);
}
export function invitationUrl(invitation) {
  parseInvitation(new URLSearchParams(invitation).toString());
  return `${COMPANION_URL}#${new URLSearchParams(invitation)}`;
}
export function validateSnapshot(state) {
  const integer = n => Number.isInteger(n) && n >= 0 && n <= 4294967295;
  const nullableTime = n => n === null || (Number.isFinite(n) && n >= 0);
  const nullableId = n => n === null || (typeof n === 'string' && n.length > 0 && n.length <= 96);
  if (!state || Object.keys(state).sort().join(',') !== 'active,availableActions,inputActive,mediaDurationMs,mediaSelection,mediaTimeMs,phase,profile,revision,runId,sample,step,stepCount,videoEnabled,writeHealthy'
    || state.profile !== PROFILE || !integer(state.revision)
    || !['armed','idle','questionnaire','stimulusReady','playing','paused','interval','completeReady','finalizing','finished','failed'].includes(state.phase)
    || typeof state.active !== "boolean" || !Array.isArray(state.availableActions)
    || state.availableActions.length > 4 || new Set(state.availableActions).size !== state.availableActions.length
    || state.availableActions.some(action => !ACTIONS.includes(action)) || !nullableId(state.runId) || !nullableId(state.mediaSelection)
    || !nullableTime(state.mediaTimeMs) || !nullableTime(state.mediaDurationMs)
    || !(state.step === null || integer(state.step)) || !integer(state.stepCount)
    || ![state.writeHealthy,state.inputActive,state.videoEnabled].every(v => typeof v === 'boolean')) throw new Error("Incompatible Runner state.");
  const sample = state.sample;
  if (sample !== null && (!sample || Object.keys(sample).sort().join(',') !== 'arousal,elapsedMs,runId,sequence,valence'
    || sample.runId !== state.runId || !Number.isSafeInteger(sample.sequence) || sample.sequence < 1
    || !Number.isFinite(sample.elapsedMs) || sample.elapsedMs < 0
    || ![sample.valence,sample.arousal].every(n => Number.isFinite(n) && n >= -1 && n <= 1))) throw new Error('Invalid participant rating.');
  return state;
}
