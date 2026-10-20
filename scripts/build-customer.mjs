import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
assert(process.argv.slice(2).every(arg => arg === '--check'), 'Unknown argument');

function emit(relativePath, text) {
  const path = resolve(root, relativePath);
  if (check) {
    assert.equal(readFileSync(path, 'utf8'), text, `Regenerate ${relativePath}`);
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  console.log(`${check ? 'Checked' : 'Generated'} ${relativePath}`);
}

function emitJson(relativePath, value) {
  emit(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

for (const stage of ['01-foundation', '02-app-ws', '03-access']) {
  const compiled = execFileSync('bicep', [
    'build', resolve(root, 'infra', 'customer', `${stage}.bicep`), '--stdout',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  emitJson(`customer/infra/${stage}.json`, JSON.parse(compiled));
}

for (const [source, destination] of [
  ['logicapp/host.json', 'customer/logicapp/host.json'],
  ['logicapp/connections.json', 'customer/logicapp/connections.json'],
  ['logicapp/monthly-export/workflow.json', 'customer/logicapp/monthly-export/workflow.json'],
  ['settings/settings.json', 'customer/settings/sample.json'],
  ['settings/settings-b.json', 'customer/settings/azureactivity.json'],
]) {
  emitJson(destination, JSON.parse(readFileSync(resolve(root, source), 'utf8')));
}

const workflow = JSON.parse(readFileSync(resolve(root, 'logicapp', 'monthly-export', 'workflow.json'), 'utf8'));
emitJson('customer/logicapp/monthly-export/definition.json', workflow.definition);
