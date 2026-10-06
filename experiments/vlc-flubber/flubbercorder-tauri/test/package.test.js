import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const builder = join(root, 'build-recorder-installer.ps1');
const downloaderTest = join(root, 'test/download-player.ps1');
const workflow = join(root, '..', '..', '..', '.github', 'workflows', 'flubber-recorder-package.yml');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();

test('Recorder workflow removes isolated player staging before dependency installation', () => {
  const source = readFileSync(workflow, 'utf8');
  const stage = source.indexOf('- name: Download and stage the exact standalone player package');
  const build = source.indexOf('- name: Build Recorder bound to the published player artifact');
  const uninstall = source.indexOf('- name: Uninstall staging and require an absent player dependency');
  const install = source.indexOf('- name: Install and verify Recorder package candidate');
  assert.ok(stage >= 0 && stage < build && build < uninstall && uninstall < install);
  assert.match(source.slice(stage, build), /Join-Path \$source 'installed-player'/u);
  assert.doesNotMatch(source.slice(stage, build), /Join-Path \$env:LOCALAPPDATA 'Programs\\FlubberVLCPlayer'/u);
  assert.match(source.slice(stage, build), /\$provenance\.setupSha256 -ine \$env:PLAYER_SETUP_SHA256/u);
  assert.match(source.slice(uninstall, install), /Start-Process -FilePath \$uninstaller/u);
  assert.match(source.slice(uninstall, install), /The default player installation must be absent/u);
  assert.match(source.slice(install), /Recorder dependency test requires no preinstalled player/u);
  assert.match(source.slice(install), /\$recorder --verify-player/u);
});

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
