import assert from 'node:assert/strict';
import test from 'node:test';

test('single-video controls follow the correlated local player state through Stop and rearm', async () => {
  const ids = [
    'choose-player', 'connect-player', 'disconnect-player', 'control-status',
    'video-section', 'choose-video', 'video-name', 'arm-video', 'play-video',
    'pause-video', 'resume-video', 'stop-video', 'video-status', 'player-status',
    'choose-master', 'master-name', 'inspect', 'plan', 'inspection-status',
    'variant', 'language', 'path', 'participant', 'plan-participant',
    'plan-steps', 'plan-identity',
  ];
  const elements = new Map(ids.map((id) => [id, {
    textContent: '', disabled: false, hidden: false, value: '',
    addEventListener(_type, listener) { this.click = listener; },
  }]));
  const calls = [];
  let state = { connected: false, phase: 'idle', generation: 0 };
  const replies = {
    arm: { connected: true, phase: 'armed', generation: 1 },
    play: { connected: true, phase: 'start-requested', generation: 1 },
    pause: { connected: true, phase: 'pause-requested', generation: 1 },
    resume: { connected: true, phase: 'start-requested', generation: 1 },
    stop: { connected: true, phase: 'idle', generation: 1 },
  };
  const saved = {
    window: globalThis.window, document: globalThis.document,
    ResizeObserver: globalThis.ResizeObserver, MutationObserver: globalThis.MutationObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
  };
  try {
    globalThis.window = { __TAURI__: { core: { invoke: async (command, args) => {
      calls.push([command, args]);
      if (command === 'player_status') return { ready: true, detail: 'Verified player' };
      if (command === 'choose_video') return 'clip.mp4';
      if (command === 'connect_player') state = { connected: true, phase: 'idle', generation: 0 };
      if (command === 'control_video') state = replies[args.action];
      if (command === 'control_status') return state;
      return state;
    } } } };
    globalThis.document = {
      getElementById: (id) => elements.get(id),
      fonts: { ready: Promise.resolve() },
    };
    globalThis.ResizeObserver = class { observe() {} };
    globalThis.MutationObserver = class { observe() {} };
    globalThis.requestAnimationFrame = () => 0;
    globalThis.setInterval = () => 1;
    globalThis.clearInterval = () => {};
    await import('../web/app.js');
    const button = (id) => elements.get(id);
    assert.equal(button('arm-video').disabled, true);
    await button('choose-video').click();
    await button('connect-player').click();
    assert.equal(button('arm-video').disabled, false);
    await button('arm-video').click();
    assert.equal(button('play-video').disabled, false);
    await button('play-video').click();
    assert.equal(button('pause-video').disabled, false);
    assert.equal(button('stop-video').disabled, false);
    await button('pause-video').click();
    assert.equal(button('resume-video').disabled, false);
    await button('resume-video').click();
    await button('stop-video').click();
    assert.equal(button('arm-video').disabled, false);
    assert.equal(button('connect-player').disabled, true);
    assert.match(button('control-status').textContent, /generation 1/);
    assert.deepEqual(
      calls.filter(([command]) => command === 'control_video').map(([, args]) => args.action),
      ['arm', 'play', 'pause', 'resume', 'stop'],
    );
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});
