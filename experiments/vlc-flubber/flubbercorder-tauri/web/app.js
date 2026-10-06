import {
  measureLineStats,
  measureNaturalWidth,
  prepareWithSegments,
} from './vendor/pretext/layout.js';

const invoke = window.__TAURI__?.core?.invoke;
const $ = (id) => document.getElementById(id);
const disconnected = { connected: false, phase: 'idle', generation: 0 };
const phaseNames = {
  idle: 'Ready',
  armed: 'Armed',
  'start-requested': 'Play requested',
  'pause-requested': 'Pause requested',
  'stop-requested': 'Stop requested',
};
let control = disconnected;
let hasVideo = false;
let busy = false;
let polling = false;
let monitor = null;
let measureQueued = false;

function measureText() {
  for (const element of document.querySelectorAll('#video-section button, #video-section p, #control-status')) {
    const text = element.textContent.trim();
    if (!text) continue;
    const style = getComputedStyle(element);
    const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    if (width <= 0 || height <= 0) continue;
    try {
      const font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
      const letterSpacing = style.letterSpacing === 'normal' ? 0 : parseFloat(style.letterSpacing);
      const prepared = prepareWithSegments(text, font, { letterSpacing });
      const stats = measureLineStats(prepared, width);
      const lineHeight = parseFloat(style.lineHeight);
      element.dataset.textLayout = measureNaturalWidth(prepared) <= width + 1 && stats.lineCount === 1
        ? 'single' : 'wrapped';
      element.dataset.textFit = stats.maxLineWidth <= width + 1 && stats.lineCount * lineHeight <= height + 2
        ? 'fits' : 'needs-space';
    } catch {
      element.dataset.textFit = 'unavailable';
    }
  }
}

function scheduleMeasure() {
  if (measureQueued) return;
  measureQueued = true;
  requestAnimationFrame(() => {
    measureQueued = false;
    measureText();
  });
}

function renderControl() {
  const ready = control.connected && !busy;
  const phase = control.phase;
  $('connect-player').disabled = busy || control.connected;
  $('disconnect-player').disabled = busy || !control.connected;
  $('choose-player').disabled = busy || control.connected;
  $('choose-video').disabled = busy || (control.connected && phase !== 'idle');
  $('arm-video').disabled = !ready || !hasVideo || phase !== 'idle';
  $('play-video').disabled = !ready || phase !== 'armed';
  $('pause-video').disabled = !ready || phase !== 'start-requested';
  $('resume-video').disabled = !ready || phase !== 'pause-requested';
  $('stop-video').disabled = !ready || !['armed', 'start-requested', 'pause-requested'].includes(phase);
  $('control-status').textContent = control.connected
    ? 'Connected · ' + (phaseNames[phase] || phase) + ' · generation ' + control.generation
    : 'Not connected';
  scheduleMeasure();
}

function setControl(view) {
  control = view;
  renderControl();
}

function stopMonitor() {
  if (monitor) clearInterval(monitor);
  monitor = null;
}

async function syncControl() {
  try {
    setControl(await invoke('control_status'));
  } catch {
    setControl(disconnected);
  }
}

function startMonitor() {
  stopMonitor();
  monitor = setInterval(async () => {
    if (busy || polling) return;
    polling = true;
    const wasConnected = control.connected;
    await syncControl();
    if (wasConnected && !control.connected) {
      $('video-status').textContent = 'Player connection ended. Connect again before arming.';
      stopMonitor();
    }
    polling = false;
  }, 1000);
}

async function refreshPlayer() {
  try {
    const status = await invoke('player_status');
    $('player-status').textContent = status.ready ? status.detail : 'Unavailable: ' + status.detail;
  } catch {
    $('player-status').textContent = 'Player check failed.';
  }
}

$('choose-player').addEventListener('click', async () => {
  busy = true;
  renderControl();
  try {
    const selected = await invoke('choose_player');
    await refreshPlayer();
    if (selected) {
      stopMonitor();
      setControl(disconnected);
      $('video-status').textContent = 'Player installation selected. Connect to control a video.';
    }
  } catch (error) {
    $('player-status').textContent = 'Unavailable: ' + error;
  } finally {
    busy = false;
    renderControl();
  }
});

$('connect-player').addEventListener('click', async () => {
  busy = true;
  renderControl();
  $('video-status').textContent = 'Connecting to the local player…';
  try {
    setControl(await invoke('connect_player'));
    $('video-status').textContent = 'Player connected. Arm a selected video.';
    startMonitor();
  } catch (error) {
    setControl(disconnected);
    $('video-status').textContent = 'Connection failed: ' + error;
  } finally {
    busy = false;
    renderControl();
  }
});

$('disconnect-player').addEventListener('click', async () => {
  busy = true;
  renderControl();
  try {
    setControl(await invoke('disconnect_player'));
    $('video-status').textContent = 'Player disconnected.';
    stopMonitor();
  } catch (error) {
    $('video-status').textContent = 'Disconnect failed: ' + error;
    await syncControl();
  } finally {
    busy = false;
    renderControl();
  }
});

$('choose-video').addEventListener('click', async () => {
  busy = true;
  renderControl();
  try {
    const name = await invoke('choose_video');
    if (name) {
      hasVideo = true;
      $('video-name').textContent = name;
      $('video-status').textContent = 'Video selected. Connect and Arm to prepare it.';
    }
  } catch (error) {
    $('video-status').textContent = 'Video selection failed: ' + error;
  } finally {
    busy = false;
    renderControl();
  }
});

for (const [id, action, message] of [
  ['arm-video', 'arm', 'Video armed. Press Play when ready.'],
  ['play-video', 'play', 'Play requested from the local player.'],
  ['pause-video', 'pause', 'Pause requested from the local player.'],
  ['resume-video', 'resume', 'Resume requested from the local player.'],
  ['stop-video', 'stop', 'Player stopped. You can Arm another video.'],
]) {
  $(id).addEventListener('click', async () => {
    busy = true;
    renderControl();
    $('video-status').textContent = 'Sending ' + action + '…';
    try {
      setControl(await invoke('control_video', { action }));
      $('video-status').textContent = message;
    } catch (error) {
      $('video-status').textContent = action + ' failed: ' + error;
      await syncControl();
    } finally {
      busy = false;
      renderControl();
    }
  });
}

$('choose-master').addEventListener('click', async () => {
  try {
    const name = await invoke('choose_master');
    if (name) {
      $('master-name').textContent = name;
      $('plan').hidden = true;
      $('inspection-status').textContent = 'Inspect the selected route before use.';
    }
  } catch (error) {
    $('inspection-status').textContent = String(error);
  }
});

$('inspect').addEventListener('click', async () => {
  $('plan').hidden = true;
  $('inspection-status').textContent = 'Inspecting…';
  const selector = {
    variantId: $('variant').value.trim(),
    languageId: $('language').value.trim(),
    languageSelectionPath: $('path').value.split(',').map((part) => part.trim()).filter(Boolean),
    presentationTarget: 'desktop-screen',
  };
  try {
    const plan = await invoke('inspect_master', {
      participant: $('participant').value.trim(),
      selectorJson: JSON.stringify(selector),
    });
    $('plan-participant').textContent = plan.participantId;
    $('plan-steps').textContent = String(plan.steps.length);
    $('plan-identity').textContent = plan.planIdentitySha256;
    $('plan').hidden = false;
    $('inspection-status').textContent = 'The installed player accepted this selected plan. Research Start remains unavailable.';
  } catch (error) {
    $('inspection-status').textContent = 'Inspection failed: ' + error;
  }
});

new ResizeObserver(scheduleMeasure).observe($('video-section'));
new MutationObserver(scheduleMeasure).observe($('video-section'), { subtree: true, childList: true, characterData: true });
new MutationObserver(scheduleMeasure).observe($('control-status'), { subtree: true, childList: true, characterData: true });
document.fonts.ready.then(scheduleMeasure);
renderControl();
refreshPlayer();
