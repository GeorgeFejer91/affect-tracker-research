import { prepareWithSegments, measureLineStats, measureNaturalWidth } from './vendor/pretext/layout.js';

const fragment = location.hash.slice(1);
const match = /^(local|phone):([A-Za-z0-9_-]{40,})$/.exec(fragment);
const role = match?.[1] || sessionStorage.getItem('flubberRole');
const token = match?.[2] || sessionStorage.getItem('flubberToken');
if (match) {
  sessionStorage.setItem('flubberRole', role);
  sessionStorage.setItem('flubberToken', token);
  history.replaceState(null, '', location.pathname);
}
document.body.classList.toggle('phone', role === 'phone');
document.querySelector('#role').textContent = role === 'phone' ? 'Phone controller' : 'Experimenter window';

const $ = selector => document.querySelector(selector);
const set = (selector, value) => { $(selector).textContent = value ?? '—'; };
let lastState;
let pending = false;

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
  for (const button of document.querySelectorAll('[data-action]')) {
    const action = button.dataset.action;
    button.disabled = pending || !enabled && !['load', 'prepare'].includes(action) ||
      (action === 'load' && phase && !['empty', 'complete', 'error', 'loaded'].includes(phase)) ||
      (action === 'prepare' && phase !== 'loaded') ||
      (action === 'start' && phase !== 'armed') ||
      (action === 'pause' && phase !== 'running') ||
      (action === 'resume' && phase !== 'paused') ||
      (action === 'stop' && !['running', 'paused'].includes(phase)) ||
      (['up', 'down', 'left', 'right'].includes(action) && phase !== 'running');
  }
}

function render(state) {
  lastState = state;
  set('#phase', state.phase);
  set('#video', state.video);
  set('#ratio', state.panelPercent == null ? null : `${state.panelPercent}% of video height`);
  const value = state.lsl.value;
  set('#affect', value ? `Valence ${value.valence.toFixed(2)} · Arousal ${value.arousal.toFixed(2)}` : 'Waiting for samples');
  set('#recorder', state.recorder ? state.recorder.alive ? 'Recording process running' : 'Recording process stopped' : 'Not started');
  set('#error', state.error || '');
  const streams = Object.entries(state.lsl.streams).map(([name, ids]) => `${name}: ${ids.length}`).join(' · ');
  set('#streams', streams || 'No Flubber outlets discovered');
  set('#subscriptions', state.recorder ? Object.values(state.recorder.subscribed).join(', ') || 'Waiting' : null);
  set('#first-data', state.recorder ? state.recorder.firstData.join(', ') || 'Waiting' : null);
  set('#markers', state.lsl.markers.map(m => m.label).join(' → ') || 'Waiting');
  if (role === 'local') {
    if (state.recipePath && !$('#recipe-path').value) $('#recipe-path').value = state.recipePath;
    set('#xdf', state.xdfPath || (state.phase === 'finalizing' ? 'Finalizing' : '—'));
    set('#csv', state.csvPath);
    set('#phone-status', state.phoneEnabled ? 'Phone has control' : 'Phone control off');
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
    send(action, action === 'load' ? { path: $('#recipe-path').value.trim() } : {});
  });
}
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
    for (const element of document.querySelectorAll('button.fit, dd')) {
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
