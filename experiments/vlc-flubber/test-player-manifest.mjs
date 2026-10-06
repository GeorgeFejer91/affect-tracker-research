import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = join(dirname(fileURLToPath(import.meta.url)), 'write-player-manifest.ps1');
const components = [
  'FlubberVLC.exe',
  'vlc/vlc.exe',
  'ffmpeg/ffmpeg.exe',
  'ffmpeg/ffprobe.exe',
  'plugins/video_filter/libflubber_plugin.dll',
  'svg/flubber_svg.dll',
  'lsl.dll',
];

function run(stage) {
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  return spawnSync(shell, ['-NoProfile', '-File', script, '-StagePath', stage], {
    encoding: 'utf8',
    timeout: 30_000,
  });
}

test('player manifest has Recorder keys and a deterministic full inventory', () => {
  const stage = mkdtempSync(join(tmpdir(), 'flubber-player-manifest-'));
  try {
    for (const name of [...components, 'vlc/plugins/video_output/example.dll']) {
      const path = join(stage, ...name.split('/'));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, name);
    }
    const first = run(stage);
    assert.equal(first.status, 0, first.stderr || first.error?.message);
    const bytes = readFileSync(join(stage, 'manifest.json'));
    assert.equal(bytes[0], 0x7b, 'manifest starts with { and has no UTF-8 BOM');
    const manifest = JSON.parse(bytes);
    assert.deepEqual(Object.keys(manifest), components);
    for (const name of components) {
      assert.equal(manifest[name], createHash('sha256').update(name).digest('hex'));
    }
    const full = JSON.parse(readFileSync(join(stage, 'payload-manifest.json')));
    assert.deepEqual(Object.keys(full).sort(), [...components, 'manifest.json', 'vlc/plugins/video_output/example.dll'].sort());
    assert.equal(full['manifest.json'], createHash('sha256').update(bytes).digest('hex'));
    const second = run(stage);
    assert.equal(second.status, 0, second.stderr || second.error?.message);
    assert.deepEqual(readFileSync(join(stage, 'manifest.json')), bytes);
    rmSync(join(stage, 'lsl.dll'));
    const missing = run(stage);
    assert.notEqual(missing.status, 0, 'missing trusted component must fail');
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
});
