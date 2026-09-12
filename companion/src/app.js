import './style.css';
import professorIcon from '../../runner/assets/professor-widget.svg';
import { parseInvitation, validateSnapshot } from './profile.js';
import { RatingTimeline, paintTimeline } from './timeline.js';
import { createTransport, createController } from './connection.js';
import { installVideoLane } from './video.js';

export function bootProfessor(root, { location = window.location, history = window.history,
  transportFactory = createTransport } = {}) {
  let invitation = null;
  try { invitation = parseInvitation(location.hash); } catch { /* Show pairing instructions. */ }
  history.replaceState(null, '', location.pathname + location.search);
  root.innerHTML = `<header><img class="professor-icon" src="${professorIcon}" alt=""><div><h1>Absent Minded Professor</h1><p>Experimenter companion</p></div></header>
    <section class="connection"><p id="connection-status" role="status"></p><button id="connect">Connect</button><button id="disconnect" hidden>Disconnect</button></section>
    <section aria-label="Experiment monitor" class="monitor"><div class="monitor-heading"><h2>Live experiment</h2><span id="phase">Waiting for Runner</span></div>
      <div class="video-surface"><img id="video-preview" alt="Current participant video" hidden><p id="video-status">Video preview is unavailable until paired.</p></div>
      <dl><div><dt>Progress</dt><dd id="progress">—</dd></div><div><dt>Recording</dt><dd id="recording">—</dd></div><div><dt>Participant input</dt><dd id="input">—</dd></div></dl>
      <div class="experiment-controls"><button data-action="start" disabled>Start</button><button data-action="pause" disabled>Pause</button><button data-action="resume" disabled>Resume</button><button data-action="stop" disabled>Stop experiment</button></div>
      <p id="command-status" role="status"></p></section>
    <button class="timeline-widget" id="ratings-widget" aria-haspopup="dialog"><svg viewBox="0 0 48 40" aria-hidden="true"><path d="M3 3v14h42M3 23v14h42" class="axis"/><path d="m5 12 7-4 7 6 7-9 8 5 9-3" class="valence"/><path d="m5 31 7 3 7-7 7 6 8-8 9 4" class="arousal"/></svg><span><strong>Ratings timeline</strong><small>Valence &amp; arousal over time</small></span><span aria-hidden="true">↗</span></button>
    <p class="local-note">The participant rates on the local Runner. Research recordings stay on that computer. <a href="./licenses/">Licenses</a></p>
    <dialog id="ratings-dialog" aria-labelledby="ratings-title"><div class="dialog-heading"><h2 id="ratings-title">Ratings timeline</h2><button id="close-ratings">Close</button></div>
      <label class="range">Time shown <select id="timeline-range"><option value="300000">Last 5 minutes</option><option value="1800000">Last 30 minutes</option><option value="7200000">Whole session (up to 2 hours)</option></select></label>
      <figure><figcaption>Valence <span>Unpleasant −1 · Pleasant +1</span></figcaption><canvas id="valence-chart" role="img" aria-label="Valence over experiment time"></canvas></figure>
      <figure><figcaption>Arousal <span>Calm −1 · Activated +1</span></figcaption><canvas id="arousal-chart" role="img" aria-label="Arousal over experiment time"></canvas></figure>
      <p id="rating-values" role="status">Waiting for participant ratings.</p><p class="local-note">Live monitor, sampled up to 4 times per second. Gaps indicate missing observations. Original data is recorded locally.</p></dialog>
    <dialog id="stop-dialog" aria-labelledby="stop-title"><h2 id="stop-title">Stop this experiment?</h2><p>The Runner will finish the current attempt early and save its local data.</p><div class="dialog-actions"><button id="cancel-stop">Keep running</button><button id="confirm-stop">Stop experiment</button></div></dialog>`;
  const $ = id => root.querySelector(`#${id}`);
  const timeline = new RatingTimeline();
  let connection = null, state = null, generation = 0, pending = null, lastState = -Infinity, stale = true;
  let timer = null;
  let video = null, videoUrl = null, videoAt = -Infinity, videoSelection = null;
  function clearVideo() {
    $('video-preview').hidden = true; $('video-preview').removeAttribute('src');
    if (videoUrl) URL.revokeObjectURL(videoUrl); videoUrl = null;
    $('video-status').hidden = false;
  }
  const status = value => { $('connection-status').textContent = value; };
  function draw() {
    if (!$('ratings-dialog').open) return;
    const windowMs = Number($('timeline-range').value);
    for (const dimension of ['valence', 'arousal']) paintTimeline($(`${dimension}-chart`), timeline, dimension, { windowMs });
  }
  function controls() {
    stale = performance.now() - lastState > 2000;
    for (const button of root.querySelectorAll('[data-action]')) button.disabled = Boolean(pending) || stale || connection?.phase !== 'ready' || !state?.availableActions.includes(button.dataset.action) || !connection.acceptedScopes.includes('runner.operate');
    if (connection?.phase === 'ready' && stale) { timeline.disconnect(); status('Connection interrupted — waiting for fresh Runner state.'); }
    if (pending && performance.now() - pending.sentAt > 10000) {
      $('command-status').textContent = 'Acknowledgement delayed. Check the local Runner; the command will not be sent again automatically.';
    }
    if (performance.now() - videoAt > 3000 || stale) {
      clearVideo(); $('video-status').textContent = state?.videoEnabled ? 'Waiting for current video preview…' : 'Video preview is off or unavailable.';
    }
  }
  function accept(event) {
    try {
      const next = validateSnapshot(event.detail.state);
      if (state && (next.revision < state.revision || (next.revision === state.revision && next.sample?.runId === state.sample?.runId && next.sample?.sequence < state.sample?.sequence))) return;
      state = next; lastState = performance.now();
      if (videoSelection !== next.mediaSelection || !['playing','paused'].includes(next.phase)) { clearVideo(); videoSelection = next.mediaSelection; videoAt = -Infinity; }
      if (next.sample) timeline.accept(next.sample);
      status('Connected to the local Runner.');
      $('phase').textContent = ({ armed: 'Ready for remote Start', idle: 'Preparing locally', stimulusReady: 'Preparing video', completeReady: 'Completing' })[next.phase] ?? next.phase;
      $('progress').textContent = next.step ? `Step ${next.step} of ${next.stepCount}` : '—';
      $('recording').textContent = next.active ? (next.writeHealthy ? 'Writing locally' : 'Needs local attention') : 'No active attempt';
      $('input').textContent = next.active ? (next.inputActive ? 'Active locally' : 'Waiting for local input') : '—';
      if (next.sample) $('rating-values').textContent = `Valence ${next.sample.valence.toFixed(2)} · Arousal ${next.sample.arousal.toFixed(2)} · ${(next.sample.elapsedMs / 1000).toFixed(1)} seconds`;
      controls(); draw();
    } catch { status('Runner sent an incompatible state. Disconnect and pair again.'); void disconnect(); }
  }
  async function disconnect() {
    ++generation; const old = connection; connection = null; invitation = null; pending = null;
    video?.close(); video = null; clearVideo();
    clearInterval(timer); timer = null; timeline.disconnect(); lastState = -Infinity;
    $('connect').disabled = true; $('disconnect').hidden = true;
    status('Disconnected. Scan a new QR code in the local Runner to pair again.'); controls();
    await old?.close();
  }
  async function connect() {
    if (!invitation || connection) return;
    const ticket = ++generation; $('connect').disabled = true; status('Connecting…');
    try {
      const transport = await transportFactory(invitation, 'controller');
      if (ticket !== generation) { await transport.stop(); return; }
      const current = createController(transport, invitation); connection = current;
      video = installVideoLane(transport, current, { receive(frame) {
        if (connection !== current || frame.runId !== state?.runId || frame.selection !== state?.mediaSelection || !state.videoEnabled) return;
        try {
          const bytes = Uint8Array.from(atob(frame.base64), c => c.charCodeAt(0));
          if (bytes[0] !== 255 || bytes[1] !== 216 || bytes.length > 98304) return;
          clearVideo(); videoUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
          $('video-preview').src = videoUrl; $('video-preview').hidden = false; $('video-status').hidden = true; videoAt = performance.now();
        } catch { clearVideo(); }
      } });
      const guarded = fn => event => { if (connection === current && ticket === generation) fn(event); };
      current.addEventListener('state', guarded(accept)); current.addEventListener('snapshot', guarded(accept));
      current.addEventListener('peerclose', guarded(() => { void disconnect(); }));
      current.addEventListener('protocolerror', guarded(() => { void disconnect(); }));
      current.addEventListener('commandapplied', guarded(event => {
        if (event.detail.commandId !== pending?.id) return;
        $('command-status').textContent = event.detail.ok ? 'Runner confirmed the command.' : 'Runner rejected the command. Check its current state.';
        pending = null; controls();
      }));
      $('disconnect').hidden = false; timer = setInterval(controls, 250);
      await transport.start();
    } catch { if (ticket === generation) await disconnect(); }
  }
  function send(action) {
    controls();
    if (!connection || pending || stale || !state?.availableActions.includes(action)) return;
    try { pending = { id: connection.sendCommand('runner.operate', action, {}, { expectedRevision: state.revision }), sentAt: performance.now() };
      $('command-status').textContent = 'Waiting for Runner confirmation…'; controls();
    } catch { $('command-status').textContent = 'Command could not be sent. Check the connection.'; }
  }
  $('connect').onclick = connect; $('disconnect').onclick = disconnect;
  for (const button of root.querySelectorAll('[data-action]')) button.onclick = () => button.dataset.action === 'stop' ? $('stop-dialog').showModal() : send(button.dataset.action);
  $('cancel-stop').onclick = () => $('stop-dialog').close();
  $('confirm-stop').onclick = () => { $('stop-dialog').close(); send('stop'); };
  $('ratings-widget').onclick = () => { $('ratings-dialog').showModal(); draw(); };
  $('close-ratings').onclick = () => $('ratings-dialog').close(); $('timeline-range').onchange = draw;
  const resize = new ResizeObserver(draw); resize.observe(root);
  const pagehide = () => { void disconnect(); }; window.addEventListener('pagehide', pagehide);
  status(invitation ? 'Invitation ready. Connect to observe and conduct the experiment.' : 'Enable Absent Minded Professor in the Windows Runner, then scan its QR code.');
  $('connect').disabled = !invitation;
  return { timeline, disconnect, destroy() { resize.disconnect(); window.removeEventListener('pagehide', pagehide); return disconnect(); } };
}
const root = document.querySelector('#professor');
if (root) bootProfessor(root);
