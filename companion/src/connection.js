import { BRSPConnection } from '../vendor/brsp/brsp.js';
import { VdoNinjaTransport } from '../vendor/brsp/vdo-ninja-transport.js';
import { CAPABILITIES as CAPS, SCOPES } from './profile.js';

export async function createTransport(invitation, role, options = {}) {
  // Bundled code; no SDK construction, signaling, or device capture on page load.
  const sdkModule = await import('../vendor/vdoninja/1.5.5/vdoninja-sdk.min.js');
  const SDK = globalThis.VDONinjaSDK ?? sdkModule.default;
  if (typeof SDK !== 'function') throw new Error('The bundled transport SDK is unavailable.');
  const transport = new VdoNinjaTransport({ role, room: invitation.room, sharedSecret: invitation.secret,
    streamId: invitation.stream, label: 'Experiment Runner', sdkFactory: settings => new SDK(settings), ...options });
  // The invitation names one target. Discovery must never substitute another one.
  const addSource = transport.addSource.bind(transport);
  transport.addSource = (value, options) => {
    const stream = typeof value === 'string' ? value : value?.streamID ?? value?.streamId;
    if (stream === invitation.stream) addSource(value, options);
  };
  return transport;
}

export class NativeProfessorConnection extends BRSPConnection {
  constructor({ invitation, invoke, ...options }) {
    super({ ...options, role: 'target', sessionId: invitation.session, sharedSecret: invitation.secret,
      peerId: invitation.targetHello.senderId, epoch: invitation.targetHello.senderEpoch,
      capabilities: CAPS, grantedScopes: invitation.targetHello.body.grantedScopes });
    this.nativeHello = invitation.targetHello;
    this.invoke = invoke;
    this.grant = null;
    this.queued = 0;
  }
  async attachPeer(detail = {}) {
    if (!detail.peerKey || this.peerKey) {
      if (detail.peerKey && detail.peerKey !== this.peerKey) this.transport.closePeer(detail.peerKey);
      return;
    }
    this.peerKey = detail.peerKey;
    this.phase = 'authenticating';
    this.localHello = this.nativeHello;
    this.sendControlEnvelope(this.localHello);
    this.emitPhase('Authenticating experimenter.');
  }
  async handleProof(proof) {
    // A fresh ordered duplicate still has to pass BRSP's transcript check,
    // but it must not replace an already verified native grant.
    if (this.phase === 'ready') { await super.handleProof(proof); return; }
    const peer = this.peerKey;
    const grant = await this.invoke('research_professor_verify', { request: { controllerHello: this.remoteHello, proof } });
    if (this.phase !== 'authenticating' || this.peerKey !== peer) throw new Error('Pairing ended.');
    this.grant = grant;
    this.currentState = await this.invoke('research_professor_snapshot', { grant: grant.handle });
    if (this.phase !== 'authenticating' || this.peerKey !== peer) throw new Error('Pairing ended.');
    await super.handleProof(proof);
  }
  queueCommand(envelope) {
    if (++this.queued > 8) { this.protocolError(new Error('Too many pending commands.')); return; }
    super.queueCommand(envelope);
    this.commandApplyChain = this.commandApplyChain.finally(() => { this.queued--; });
  }
}

export function createController(transport, invitation, { scopes = SCOPES } = {}) {
  return new BRSPConnection({ transport, role: 'controller', sessionId: invitation.session,
    sharedSecret: invitation.secret, capabilities: CAPS, requestedScopes: scopes });
}
