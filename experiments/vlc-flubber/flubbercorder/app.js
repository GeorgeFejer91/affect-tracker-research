import { prepareWithSegments, measureLineStats, measureNaturalWidth } from './vendor/pretext/layout.js';

const native = window.__TAURI__?.core?.invoke;
const fragment = location.hash.slice(1);
const match = /^(local|phone):([A-Za-z0-9_-]{40,})$/.exec(fragment);
const role = native ? 'local' : match?.[1] || sessionStorage.getItem('flubberRole');
const token = native ? null : match?.[2] || sessionStorage.getItem('flubberToken');
if (match) {
  sessionStorage.setItem('flubberRole', role);
  sessionStorage.setItem('flubberToken', token);
  history.replaceState(null, '', location.pathname);
}
document.body.classList.toggle('phone', role === 'phone');
if (native) {
  document.querySelector('.pad').hidden = true;
}
document.querySelector('#role').textContent = role === 'phone' ? 'Phone controller' : 'Experimenter window';

const $ = selector => document.querySelector(selector);
const set = (selector, value) => { $(selector).textContent = value ?? '—'; };
let lastState;
let pending = false;
let variables = [];
let variablesInitialized = false;

function renderVariables() {
  const list = $('#variable-list');
  list.replaceChildren(...variables.map((row, index) => {
    const container = document.createElement('div');
    container.className = 'variable-row';
    for (const field of ['label', 'value']) {
      const label = document.createElement('label');
      label.textContent = field === 'label' ? `Label ${index + 1}` : `Value ${index + 1}`;
      const input = document.createElement('input');
      input.maxLength = 128;
      input.value = row[field];
      input.addEventListener('input', () => { row[field] = input.value; });
      label.append(input);
      container.append(label);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.className = 'fit';
    remove.addEventListener('click', () => { variables.splice(index, 1); renderVariables(); });
    container.append(remove);
    return container;
  }));
  updateButtons();
}

function renderPlot(points) {
  const recent = points.filter(p => Number.isFinite(p.lslTime));
  const end = recent.length ? recent.at(-1).lslTime : 0;
  const path = key => recent.filter(p => p.lslTime >= end - 10).map((p, index) => {
    const x = Math.max(0, Math.min(600, (p.lslTime - end + 10) * 60));
    const y = Math.max(10, Math.min(190, 100 - p[key] * 75));
    return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  $('#valence-line').setAttribute('d', path('valence'));
  $('#arousal-line').setAttribute('d', path('arousal'));
}

function renderStreams(state) {
  const discovered = state.lsl.streams;
  const receipt = state.recorder || { subscribed: {}, firstData: [] };
  const names = ['VLC_Flubber_Affect', 'VLC_Flubber_Markers', ...state.requiredStreams];
  const list = $('#stream-list');
  list.replaceChildren();
  let visibleCount = 0;
  for (const name of names) {
    const ids = discovered[name] || [];
    const own = name === 'VLC_Flubber_Affect' || name === 'VLC_Flubber_Markers';
    const expected = state.sourceId && own ? `${state.sourceId}-${name === 'VLC_Flubber_Affect' ? 'affect' : 'markers'}` : null;
    const source = expected || (!own && ids.length === 1 ? ids[0] : null);
    const visible = own ? Boolean(expected && ids.includes(expected)) : ids.length === 1;
    if (visible) visibleCount++;
    const subscribed = source && receipt.subscribed[source] === name;
    const recording = source && receipt.firstData.includes(source);
    const row = document.createElement('div');
    row.className = 'stream-row';
    row.dataset.state = visible ? 'live' : 'missing';
    const dot = document.createElement('span');
    dot.className = 'stream-dot';
    dot.setAttribute('aria-hidden', 'true');
    const identity = document.createElement('div');
    identity.className = 'stream-name';
    identity.textContent = name;
    const id = document.createElement('span');
    id.className = 'stream-id';
    id.textContent = source || (ids.length > 1 ? 'Multiple sources found' : 'No source discovered');
    identity.append(id);
    const status = document.createElement('span');
    status.className = 'stream-state';
    status.textContent = !visible ? 'Missing' : recording ? 'Recording' : subscribed ? 'Subscribed' : 'Discovered';
    row.append(dot, identity, status);
    list.append(row);
  }
  set('#streams', `${visibleCount}/${names.length} streams visible`);
  set('#subscriptions', `${Object.keys(receipt.subscribed).length} recorder subscriptions`);
  set('#first-data', `${receipt.firstData.length} streams with data`);
}

function commandId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

async function send(action, extra = {}) {
  if (pending) return;
  pending = true;
  updateButtons();
  try {
    if (native) {
      if (action === 'prepare') await native('dispatch', { action: 'set_variables', variables });
      await native('dispatch', { action, path: extra.path || null, value: extra.value ?? null });
      if (action === 'load') { variables = []; renderVariables(); }
      set('#error', '');
      await refresh();
      return;
    }
    const response = await fetch('/command', {
      method: 'POST', cache: 'no-store',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: commandId(), action, ...extra })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Command failed');
    set('#error', '');
    await refresh();
  } catch (error) {
    set('#error', error.message);
  } finally {
    pending = false;
    updateButtons();
  }
}

function updateButtons() {
  const phase = lastState?.phase;
  const enabled = role !== 'phone' || lastState?.phoneEnabled;
  const mode = lastState?.mode;
  for (const button of document.querySelectorAll('[data-action]')) {
    const action = button.dataset.action;
    button.disabled = pending || !enabled && !['load', 'prepare'].includes(action) ||
      (action === 'connect' && mode !== 'recorder') ||
      (action === 'give_phone' && lastState?.phoneEnabled) ||
      (action === 'revoke_phone' && !lastState?.phoneEnabled) ||
      (action === 'load' && phase && !['empty', 'connected', 'complete', 'error', 'loaded'].includes(phase)) ||
      (action === 'prepare' && phase !== 'loaded') ||
      (action === 'start' && phase !== 'armed') ||
      (action === 'pause' && phase !== 'running') ||
      (action === 'resume' && phase !== 'paused') ||
      (action === 'stop' && !['running', 'paused'].includes(phase)) ||
      (['up', 'down', 'left', 'right'].includes(action) && phase !== 'running');
  }
  $('#volume').disabled = pending || !['armed', 'running', 'paused'].includes(phase);
  $('#add-variable').disabled = pending || phase !== 'loaded' || variables.length >= 6;
  for (const control of $('#variable-list').querySelectorAll('input, button')) control.disabled = pending || phase !== 'loaded';
}

function render(state) {
  lastState = state;
  if (!variablesInitialized) {
    variables = state.customVariables || [];
    variablesInitialized = true;
    renderVariables();
  }
  const mode = state.mode;
  const recordsLocally = mode === 'recorder' || mode === 'combined';
  $('#connection').hidden = mode !== 'recorder' || role === 'phone';
  $('#player-pair').hidden = mode !== 'player' || role === 'phone' || !state.playerPairUrl;
  $('#files').hidden = mode === 'player' && role === 'phone';
  $('#prepare-button').textContent = recordsLocally ? 'Prepare player and recorder' : 'Prepare video in VLC';
  set('#role', role === 'phone' ? 'Phone controller' : recordsLocally ? 'Experimenter recorder' : 'Standalone player');
  set('#player-status', mode === 'recorder' ? (state.playerConnected ? `Paired with ${state.playerUrl || 'player'}` : 'No player paired') : '');
  const indicator = $('#connection-indicator');
  indicator.dataset.state = state.phase === 'error' ? 'error' :
    state.lslReady === false || mode === 'recorder' && !state.playerConnected ? 'waiting' : 'ready';
  indicator.textContent = state.phase === 'error' ? 'Attention needed' :
    state.lslReady === false ? 'Waiting for LSL' :
    mode === 'recorder' && !state.playerConnected ? 'Player disconnected' : 'LSL available';
  set('#phase', state.phase);
  if (document.activeElement !== $('#volume')) $('#volume').value = String(state.volumePercent ?? 100);
  $('#volume-value').value = `${$('#volume').value}%`;
  set('#video', state.video);
  set('#ratio', state.panelPercent == null ? null : `${state.panelPercent}% of video height`);
  set('#required-streams', state.requiredStreams.length ? state.requiredStreams.join(', ') : 'Flubber affect and markers');
  const value = state.lsl.value;
  set('#affect', value ? `Valence ${value.valence.toFixed(2)} · Arousal ${value.arousal.toFixed(2)}` : 'Waiting for samples');
  set('#recorder', recordsLocally ? state.recorder ? state.recorder.alive ? 'Recording process running' : 'Recording process stopped' : 'Not started' : 'Remote recorder optional');
  set('#error', state.error || '');
  renderStreams(state);
  renderPlot(state.lsl.history || []);
  set('#markers', state.lsl.markers.map(m => m.label).join(' → ') || 'Waiting');
  const markerList = $('#marker-list');
  markerList.replaceChildren();
  for (const marker of state.lsl.markers.slice(-5)) {
    const item = document.createElement('li');
    item.textContent = marker.label;
    markerList.append(item);
  }
  if (!markerList.childElementCount) {
    const item = document.createElement('li');
    item.textContent = 'Waiting for video';
    markerList.append(item);
  }
  if (role === 'local') {
    $('#demo-hint').hidden = !state.bundledDemo || state.phase !== 'loaded';
    if (state.bundledDemo) $('#demo-hint').textContent =
      `${state.video || 'Player preset'} is loaded. Prepare the session, then start playback.`;
    if (state.recipePath && !$('#recipe-path').value) $('#recipe-path').value = state.recipePath;
    set('#xdf', state.xdfPath || (state.phase === 'finalizing' ? 'Finalizing' : '—'));
    set('#metadata', state.metadataPath);
    set('#csv', state.csvPath);
    set('#phone-status', state.phoneEnabled ? 'Phone has control' : 'Phone control off');
    if (state.playerPairUrl) $('#player-pair-link').value = state.playerPairUrl;
    const link = $('#phone-link');
    link.hidden = !state.phoneUrl;
    $('#copy-phone').hidden = !state.phoneUrl;
    if (state.phoneUrl) {
      link.href = state.phoneUrl;
      link.textContent = state.phoneUrl.split('#')[0];
    }
  }
  updateButtons();
  requestAnimationFrame(checkText);
}

async function refresh() {
  if (native) {
    try { render(await native('snapshot')); }
    catch (error) { set('#error', String(error)); }
    return;
  }
  if (!token) { set('#error', 'Open the paired Flubbercorder link.'); return; }
  try {
    const response = await fetch('/state', { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Connection or pairing failed');
    render(await response.json());
  } catch (error) {
    set('#error', error.message);
  }
}

for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    send(action, action === 'load' ? { path: $('#recipe-path').value.trim() } :
      action === 'connect' ? { link: $('#player-link').value.trim() } : {});
  });
}
$('#volume').addEventListener('input', () => { $('#volume-value').value = `${$('#volume').value}%`; });
$('#volume').addEventListener('change', () => send('volume', { value: Number($('#volume').value) }));
$('#add-variable').addEventListener('click', () => {
  if (variables.length < 6) { variables.push({ label: '', value: '' }); renderVariables(); }
});
$('#copy-player').addEventListener('click', async () => {
  if (lastState?.playerPairUrl) await navigator.clipboard.writeText(lastState.playerPairUrl);
});
$('#copy-phone').addEventListener('click', async () => {
  if (lastState?.phoneUrl) await navigator.clipboard.writeText(lastState.phoneUrl);
});

// Keep allocated control boxes readable. Pretext predicts label fit; CSS wraps
// the full label when a narrow viewport or enlarged font defeats one-line fit.
let measurementReady = false;
let scheduled = false;
function checkText() {
  if (!measurementReady || scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const element of document.querySelectorAll('button.fit, dd, .stream-name, .stream-state, #affect, .marker-view li, #variables-title, #variables-note, .volume-control span')) {
      const style = getComputedStyle(element);
      const text = element.textContent.trim();
      if (!text) continue;
      const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2;
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const prepared = prepareWithSegments(text, font, { letterSpacing: parseFloat(style.letterSpacing) || 0 });
      const stats = measureLineStats(prepared, Math.max(1, width));
      const oneLine = stats.lineCount <= 1 && measureNaturalWidth(prepared) <= width;
      element.dataset.textFit = oneLine ? 'one-line' : 'wrapped';
    }
  });
}
document.fonts.ready.then(() => { measurementReady = true; checkText(); });
new ResizeObserver(checkText).observe(document.body);
refresh();
setInterval(refresh, 250);
