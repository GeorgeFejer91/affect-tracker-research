import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src-tauri/src/main.rs'), 'utf8');
const control = readFileSync(join(root, 'src-tauri/src/control.rs'), 'utf8');
const html = readFileSync(join(root, 'web/index.html'), 'utf8');
const config = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const cargo = readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8');

test('Recorder is a distinct local installer with no copied player tree or listener', () => {
  assert.equal(config.bundle.targets, 'nsis');
  assert.equal(config.bundle.resources, undefined);
  assert.equal(config.identifier, 'io.github.georgefejer91.flubbercorder');
  assert.doesNotMatch(source, /TcpListener|tiny_http|127\.0\.0\.1|--control-stdio/);
  assert.doesNotMatch(control, /TcpListener|TcpStream|tiny_http|127\.0\.0\.1/);
  assert.doesNotMatch(cargo, /flubbercorder-native|tiny_http|labstream/);
  assert.deepEqual(readdirSync(root).filter((name) => /^(player|vlc|ffmpeg|demo|resources)$/.test(name)), []);
});

test('inspection uses the installed player and research Start stays disabled', () => {
  assert.match(source, /verify_player\(\s*&player_directory\(&selection\)\?,\s*TRUSTED_MANIFEST_SHA256,\s*TRUSTED_PAYLOAD_MANIFEST_SHA256,\s*\)\?/);
  assert.match(source, /option_env!\("FLUBBERVLC_MANIFEST_SHA256"\)/);
  assert.match(source, /option_env!\("FLUBBERVLC_PAYLOAD_MANIFEST_SHA256"\)/);
  assert.match(source, /verify_payload_tree\(&root, &root, "", &payload, &mut found\)\?/);
  assert.match(source, /found != payload\.keys\(\)\.cloned\(\)\.collect\(\)/);
  assert.match(source, /\.arg\("--inspect-master"\)/);
  assert.match(source, /\.arg\("--participant"\)/);
  assert.match(source, /\.arg\("--selector-json"\)/);
  assert.match(html, /<button[^>]+disabled[^>]*>Start research session<\/button>/);
  assert.doesNotMatch(source, /fn start_session|fn start_research/);
  assert.match(control, /\.arg\("--control-stdio"\)/);
  assert.match(control, /request_id\.as_deref\(\) != request_id/);
  assert.match(control, /self\.child\.kill\(\)/);
  assert.doesNotMatch(html, /id="arm"|id="start-player"/);
});
