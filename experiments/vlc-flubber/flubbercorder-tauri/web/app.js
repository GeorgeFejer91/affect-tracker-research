const invoke = window.__TAURI__?.core?.invoke;
const $ = (id) => document.getElementById(id);

async function refreshPlayer() {
  try {
    const status = await invoke('player_status');
    $('player-status').textContent = status.ready ? status.detail : `Unavailable: ${status.detail}`;
  } catch {
    $('player-status').textContent = 'Player check failed.';
  }
}

$('choose-player').addEventListener('click', async () => {
  try {
    await invoke('choose_player');
    await refreshPlayer();
  } catch (error) {
    $('player-status').textContent = `Unavailable: ${error}`;
  }
});

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
    $('inspection-status').textContent = `Inspection failed: ${error}`;
  }
});

refreshPlayer();
