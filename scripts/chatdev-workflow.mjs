import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = resolve(root, 'chatdev/affect-research-development.yaml');
const jointWorkflow = resolve(root, 'chatdev/affect-research-cross-app.yaml');
const core = [
  'AGENTS.md',
  'for-ai/00-READ-FIRST.md',
  'for-ai/15-RESEARCH-V1-CHARTER.md',
  'for-ai/16-COMPANION-APP-BOUNDARY.md',
  'for-ai/30-TESTING-AND-RELEASE.md',
  'for-ai/50-AGENT-WORKFLOW.md',
  'for-ai/60-SEGMENT-CATALOGUE.md',
  'for-ai/66-PLANNER-RUNNER-COMPATIBILITY.md',
  'for-ai/40-ROADMAP.md',
  'for-ai/55-AGENT-MESSAGE-BOARD.md',
  'for-ai/74-CHATDEV-DEVELOPMENT.md',
  'docs/compartment-catalog.md',
];
const owner = {
  P1: ['for-ai/20-ARCHITECTURE.md', 'docs/planner-master-recipe-v1.md'],
  P2: ['docs/planner-p2-questionnaire-recipe.md', 'docs/surveyjs-questionnaires.md', 'docs/planner-questionnaire-assets.md'],
  P3: ['docs/planner-p3-contribution-api.md', 'docs/planner-marker-contract-v1.md'],
  P4: ['docs/planner-p4-layout-contract.md'],
  P5: ['docs/planner-p5-feedback-v2.md'],
  P6: ['for-ai/63-P6-XR-LAYOUT.md', 'docs/planner-authoring-p6.md'],
  P7: ['docs/planner-master-recipe-v1.md', 'docs/planner-p7-recipe-assembly.md', 'docs/planner-questionnaire-assets.md'],
  R1: ['for-ai/65-RUNNER-SEGMENTS.md', 'for-ai/69-CLI-RUNNER-END-TO-END-GOAL.md', 'for-ai/72-RUNNER-FINAL-VALIDATION.md', 'docs/runner-master-execution-v1.md', 'docs/runner-information-stream-v1.md'],
  contracts: ['for-ai/20-ARCHITECTURE.md', 'docs/planner-master-recipe-v1.md', 'docs/runner-master-execution-v1.md'],
  integration: ['for-ai/20-ARCHITECTURE.md', 'for-ai/69-CLI-RUNNER-END-TO-END-GOAL.md', 'for-ai/72-RUNNER-FINAL-VALIDATION.md'],
  joint: ['for-ai/65-RUNNER-SEGMENTS.md', 'for-ai/69-CLI-RUNNER-END-TO-END-GOAL.md',
    'for-ai/72-RUNNER-FINAL-VALIDATION.md', 'for-ai/73-CURRENT-APP-BUILD.md',
    'docs/planner-master-recipe-v1.md', 'docs/runner-master-execution-v1.md',
    'docs/runner-information-stream-v1.md', 'docs/WEB-DELIVERY.md'],
};

function fail(message) {
  throw new Error(message);
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
}

function trackedFile(path, tracked) {
  const normalized = path.replaceAll('\\', '/');
  if (isAbsolute(path) || normalized.split('/').some((part) => part === '..' || part === '.' || !part)) {
    fail(`Expected a repository-relative file: ${path}`);
  }
  if (!tracked.has(normalized)) fail(`File is not tracked: ${normalized}`);
  const absolute = resolve(root, normalized);
  const actual = realpathSync(absolute);
  if (actual !== root && !actual.startsWith(root + sep)) fail(`File leaves repository: ${normalized}`);
  if (!lstatSync(absolute).isFile()) fail(`Expected an ordinary file: ${normalized}`);
  const bytes = readFileSync(absolute);
  const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (content.includes('\0')) fail(`Binary file cannot be attached: ${normalized}`);
  return { normalized, bytes };
}

function check() {
  const tracked = new Set(git('ls-files', '-z').split('\0').filter(Boolean));
  for (const path of new Set([...core, ...Object.values(owner).flat()])) trackedFile(path, tracked);
  const python = process.platform === 'win32' ? 'py' : 'python3';
  const probe = spawnSync(python, ['-c',
    `import sys, yaml
for path in sys.argv[1:]:
    with open(path, encoding="utf-8") as source:
        graph = yaml.safe_load(source)["graph"]
    nodes = {node["id"] for node in graph["nodes"]}
    assert nodes and all(node in nodes for node in graph["start"] + graph["end"])
    assert all(edge["from"] in nodes and edge["to"] in nodes for edge in graph["edges"])`,
    workflow, jointWorkflow], { encoding: 'utf8' });
  if (probe.status !== 0) fail(`ChatDev YAML check failed: ${probe.stderr || probe.error?.message || 'unknown error'}`);
  if (process.env.CHATDEV_HOME) {
    const home = resolve(process.env.CHATDEV_HOME);
    const schemaProbe = spawnSync(python, ['-c',
      'import sys;from pathlib import Path;sys.path.insert(0,sys.argv[1]);import entity.configs;from schema_registry import register_node_schema,register_edge_condition_schema;from entity.configs.node.agent import AgentConfig;from entity.configs.edge.edge_condition import FunctionEdgeConditionConfig;register_node_schema("agent",config_cls=AgentConfig);register_edge_condition_schema("function",config_cls=FunctionEdgeConditionConfig);from entity.config_loader import load_design_from_file;[load_design_from_file(Path(p)) for p in sys.argv[2:]]',
      home, workflow, jointWorkflow], {
      cwd: home,
      encoding: 'utf8',
      env: { ...process.env, API_KEY: process.env.API_KEY || 'schema-check-only', CHATDEV_MODEL: process.env.CHATDEV_MODEL || 'schema-check-only' },
    });
    if (schemaProbe.status !== 0) fail(`ChatDev schema validation failed: ${schemaProbe.stderr || schemaProbe.error?.message || 'unknown error'}`);
  }
  console.log(process.env.CHATDEV_HOME
    ? `ChatDev schema and ${tracked.size} tracked-file index checked.`
    : `YAML structure and ${tracked.size} tracked-file index checked; set CHATDEV_HOME for ChatDev schema validation.`);
}

function prepare(segment, outputPath, taskPath, selected) {
  if (!Object.hasOwn(owner, segment)) fail(`Unknown segment: ${segment}`);
  if (!outputPath || !taskPath) fail('Usage: prepare|run SEGMENT NEW_OUTPUT_DIR TASK_FILE [SOURCE_FILE ...]');
  const output = resolve(outputPath);
  if (output === root || output.startsWith(root + sep)) fail('Output directory must be outside the repository.');
  if (existsSync(output)) fail(`Output directory already exists: ${output}`);
  const task = readFileSync(resolve(taskPath), 'utf8').trim();
  if (!task) fail('Task file is empty.');
  const tracked = new Set(git('ls-files', '-z').split('\0').filter(Boolean));
  const paths = [...new Set([...core, ...owner[segment], ...selected])];
  const files = paths.map((path, index) => {
    const { normalized, bytes } = trackedFile(path, tracked);
    return {
      source: normalized,
      attachment: `asset-${String(index + 1).padStart(3, '0')}-${basename(normalized)}`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes,
    };
  });
  mkdirSync(output);
  const assetDir = resolve(output, 'files');
  mkdirSync(assetDir);
  for (const file of files) writeFileSync(resolve(assetDir, file.attachment), file.bytes);
  const manifest = {
    schema: 'affect-chatdev-context-v1',
    segment,
    sourceCommit: git('rev-parse', 'HEAD'),
    sourceStatus: git('status', '--short'),
    task,
    files: files.map(({ bytes, ...entry }) => ({ ...entry, byteLength: bytes.length })),
  };
  writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const lines = [
    '# Affect Research ChatDev session', '',
    `Segment: ${segment}`, `Source commit: ${manifest.sourceCommit}`, '',
    '## Task', '', task, '',
    '## Source map', '',
    ...manifest.files.map((file) => `- ${file.source} → inputs/${file.attachment} (SHA-256 ${file.sha256})`),
    '', 'Read the core documents in the order given by for-ai/00-READ-FIRST.md.',
    'Use describe_available_files and read_file_segment to inspect files in inputs/.',
    'The input files are frozen copies. Save proposals only in the ChatDev session workspace.',
    'The repository owner must validate, test, and integrate any proposed patch.', '',
  ];
  writeFileSync(resolve(output, 'SESSION.md'), lines.join('\n'));
  return { output, segment };
}

function run(bundle) {
  const home = process.env.CHATDEV_HOME;
  if (!home || !isAbsolute(home) || !existsSync(resolve(home, 'runtime/sdk.py'))) {
    fail('Set CHATDEV_HOME to an installed ChatDev 2.0 checkout.');
  }
  if (!process.env.API_KEY || !process.env.CHATDEV_MODEL) {
    fail('Set API_KEY and CHATDEV_MODEL for the chosen ChatDev model provider.');
  }
  const python = process.platform === 'win32' ? 'py' : 'python3';
  const args = [resolve(root, 'chatdev/run_segment.py'), bundle.output,
    bundle.segment === 'joint' ? jointWorkflow : workflow];
  const result = spawnSync(python, args, {
    cwd: home,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
}

try {
  const [mode, segment, output, taskFile, ...selected] = process.argv.slice(2);
  if (mode === 'check') check();
  else if (mode === 'prepare' || mode === 'run') {
    const bundle = prepare(segment, output, taskFile, selected);
    console.log(`Prepared ChatDev context in ${bundle.output}`);
    if (mode === 'run') run(bundle);
  } else fail('Usage: check | prepare|run SEGMENT NEW_OUTPUT_DIR TASK_FILE [SOURCE_FILE ...]');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
