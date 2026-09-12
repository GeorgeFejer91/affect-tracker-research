import QRCode from 'qrcode';
import { createTransport, NativeProfessorConnection } from '../../companion/src/connection.js';
import { invitationUrl, ACTIONS } from '../../companion/src/profile.js';
import { startRequest } from '../../site/src/research/native-package-protocol.js';
import { installVideoLane } from '../../companion/src/video.js';

export function createProfessorHost(root, { invoke, execute, onChange = () => {}, onArmedEnded = () => {} }) {
  const $ = id => root.querySelector(`#professor-${id}`);
  let connection = null, invitation = null, generation = 0, timer = null, expiry = null;
  let enabled = false, prepared = null, polling = false;
  let video = null, videoTimer = null, framePending = false;
  const status = message => { $('status').textContent = message; };
  const armStatus = () => { $('armed-status').textContent = prepared ? 'Waiting for Professor to start. This preparation expires after two minutes.' : ''; onChange(); };
  async function disarm() { const wasArmed = Boolean(prepared); prepared = null; armStatus(); if (enabled) await invoke('research_professor_disarm'); if (wasArmed) onArmedEnded(); }
  async function stop() {
    const wasArmed = Boolean(prepared);
    ++generation; enabled = false; prepared = null; const old = connection; connection = null; invitation = null;
    clearInterval(videoTimer); videoTimer = null; video?.close(); video = null;
    clearInterval(timer); clearTimeout(expiry); timer = expiry = null;
    $('qr').removeAttribute('src'); $('qr').hidden = true; $('enable').disabled = false; $('disable').disabled = true;
    $('copy').disabled = true;
    $('video').disabled = false;
    status('Disabled.'); armStatus();
    if (wasArmed) onArmedEnded();
    try { await invoke('research_professor_disable'); } finally { await old?.close(); }
  }
  async function enable() {
    if (enabled) return;
    const ticket = ++generation; enabled = true; $('enable').disabled = true; $('disable').disabled = false;
    $('video').disabled = true;
    status('Creating an invitation…');
    try {
      const created = await invoke('research_professor_begin', { video: $('video').checked });
      if (ticket !== generation) return;
      invitation = created;
      const { room, session, stream, secret } = created;
      const qr = await QRCode.toDataURL(invitationUrl({ room, session, stream, secret }), { width: 320, margin: 4, errorCorrectionLevel: 'M' });
      if (ticket !== generation) return;
      $('qr').src = qr; $('qr').hidden = false;
      $('copy').disabled = false;
      const transport = await createTransport(created, 'target');
      if (ticket !== generation) { await transport.stop(); return; }
      const current = new NativeProfessorConnection({ invitation: created, invoke, transport,
        getState: () => current.currentState,
        applyCommand: async command => {
          if (ticket !== generation || !current.grant || command.scope !== 'runner.operate'
            || !ACTIONS.includes(command.action) || Object.keys(command.args).length || !Number.isInteger(command.expectedRevision)) {
            return { ok: false, revision: current.currentState?.revision ?? 0, error: 'invalid_command' };
          }
          const outcome = await execute(command, current.grant.handle, prepared);
          if (command.action === 'start') { prepared = null; armStatus(); }
          current.currentState = await invoke('research_professor_snapshot', { grant: current.grant.handle });
          // Explicit allowlist: local receipt paths/participant fields never enter BRSP.
          return { ok: outcome.ok, revision: outcome.revision, result: null, error: outcome.error };
        } });
      connection = current;
      video = installVideoLane(transport, current);
      videoTimer = setInterval(async () => {
        if (ticket !== generation || current.phase !== 'ready' || !current.currentState?.videoEnabled || framePending) return;
        framePending = true;
        try {
          const frame = await invoke('research_professor_frame', { grant: current.grant.handle });
          if (ticket === generation && current.currentState?.mediaSelection === frame.selection) video?.send(frame);
        } catch { /* Native video may be unavailable or deliberately shed. */ }
        finally { framePending = false; }
      }, 1100);
      const end = () => { if (ticket === generation) void stop(); };
      current.addEventListener('peerclose', end); current.addEventListener('protocolerror', end);
      current.addEventListener('ready', () => {
        if (ticket !== generation) return;
        clearTimeout(expiry); $('qr').removeAttribute('src'); $('qr').hidden = true;
        $('copy').disabled = true;
        status('Professor connected. Participant input and recording remain local.');
      });
      timer = setInterval(async () => {
        if (polling || ticket !== generation || current.phase !== 'ready') return;
        polling = true;
        try {
          const state = await invoke('research_professor_snapshot', { grant: current.grant.handle });
          if (ticket !== generation || current.phase !== 'ready') return;
          current.currentState = state; current.publishState(state, { revision: state.revision });
          if (prepared && state.phase !== 'armed') { prepared = null; armStatus(); onArmedEnded(); }
        } catch { end(); } finally { polling = false; }
      }, 250);
      expiry = setTimeout(end, 120000);
      await transport.start();
      if (ticket === generation && current.phase !== 'ready') status('Scan the QR code, then tap Connect. Invitation expires in two minutes.');
    } catch { if (ticket === generation) { await stop(); status('Could not connect. Enable again to create a fresh invitation.'); } }
  }
  $('enable').onclick = enable; $('disable').onclick = stop;
  $('copy').onclick = async () => {
    if (!invitation || connection?.phase === 'ready') return;
    const { room, session, stream, secret } = invitation;
    try { await navigator.clipboard.writeText(invitationUrl({ room, session, stream, secret })); status('Private pairing link copied. It expires with this invitation.'); }
    catch { status('Clipboard unavailable. Scan the QR code instead.'); }
  };
  $('cancel-arm').onclick = () => { void disarm(); };
  $('wait').onchange = () => { if (!$('wait').checked && prepared) void disarm(); };
  return { get enabled() { return enabled; }, get armed() { return Boolean(prepared); },
    get waitForStart() { return enabled && $('wait').checked; },
    async arm(detail, workspaceId) {
      if (!enabled || detail.attemptDisposition !== 'new-attempt') throw new Error('Remote Start requires a locally prepared new attempt.');
      await invoke('research_professor_arm', { request: startRequest(detail, workspaceId) });
      prepared = { detail, workspaceId }; armStatus();
    }, disarm, stop };
}
