import { createHelloEnvelope, createProofEnvelope, proofTranscript } from '../companion/vendor/brsp/brsp.js';
import { CAPABILITIES, SCOPES } from '../companion/src/profile.js';
import { writeFile } from 'node:fs/promises';
// Public test vector only. Never used for real pairing.
const secret = '0123456789abcdef'.repeat(4);
const targetHello = createHelloEnvelope({ role:'target', sessionId:'professor_fixture', senderId:'target_fixture',
  senderEpoch:4294967295, nonce:'target_nonce_fixture_12345678', capabilities:CAPABILITIES, grantedScopes:SCOPES });
const controllerHello = createHelloEnvelope({ role:'controller', sessionId:'professor_fixture', senderId:'controller_fixture',
  senderEpoch:2147483648, nonce:'controller_nonce_fixture_12345678', capabilities:CAPABILITIES, requestedScopes:SCOPES });
export const fixture = { secret, targetHello, controllerHello,
  transcript:proofTranscript(targetHello, controllerHello),
  proof:await createProofEnvelope({ localHello:controllerHello, remoteHello:targetHello, secret, sequence:1 }) };
if (process.argv.includes('--write')) await writeFile(new URL('../test/fixtures/professor-proof.json', import.meta.url), JSON.stringify(fixture,null,2)+'\n');
