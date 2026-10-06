import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const builder = join(root, 'build-recorder-installer.ps1');
const downloaderTest = join(root, 'test/download-player.ps1');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();

test('Recorder package accepts only one matching player setup and manifest receipt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flubber-recorder-package-'));
  try {
    const stage = join(dir, 'stage');
    mkdirSync(stage);
    const setup = join(dir, 'Flubber_VLC_Player_Setup_0.1.0_x64.exe');
    const receipt = join(dir, 'player-package-provenance.json');
    const setupBytes = Buffer.from('standalone player setup fixture');
    const manifest = Buffer.from('{"FlubberVLC.exe":"abc"}\n');
    const payload = Buffer.from('{"manifest.json":"def"}\n');
    writeFileSync(setup, setupBytes);
    writeFileSync(join(stage, 'manifest.json'), manifest);
    writeFileSync(join(stage, 'payload-manifest.json'), payload);
    const provenance = {
      schema: 'flubber-vlc-player-package-provenance/v1',
      sourceCommit: 'fixture',
      setupFileName: 'Flubber_VLC_Player_Setup_0.1.0_x64.exe',
      setupByteLength: setupBytes.length,
      setupSha256: hash(setupBytes),
      manifestSha256: hash(manifest),
      payloadManifestSha256: hash(payload),
      researchQualified: false,
    };
    writeFileSync(receipt, JSON.stringify(provenance));
    const validate = (url = 'https://example.org/releases/Flubber_VLC_Player_Setup.exe') => spawnSync(
      'pwsh', ['-NoProfile', '-File', builder, '-PlayerSetupUrl', url,
        '-PlayerSetupPath', setup, '-PlayerStagePath', stage,
        '-PlayerProvenancePath', receipt, '-ValidateOnly'],
      { encoding: 'utf8' },
    );
    assert.equal(validate().status, 0);
    assert.notEqual(validate('http://example.org/player.exe').status, 0);
    writeFileSync(setup, 'altered player setup fixture');
    assert.notEqual(validate().status, 0);
    writeFileSync(setup, setupBytes);
    writeFileSync(join(stage, 'payload-manifest.json'), 'changed manifest');
    assert.notEqual(validate().status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('player setup download verifies exact bytes and removes failed downloads', () => {
  const result = spawnSync('pwsh', ['-NoProfile', '-File', downloaderTest], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
