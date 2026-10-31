import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

const sample = JSON.parse(readFileSync(resolve(root, 'settings', 'sample.json'), 'utf8'));
const stages = {
  '01-foundation': {
    location: 'southeastasia',
    prefix: 'lawexp',
  },
  '02-workflow': {
    location: 'southeastasia',
    workflowName: 'lawexp-monthly',
    storageAccountName: '<STORAGE_ACCOUNT_NAME>',
    lawResourceId: '/subscriptions/<LAW_SUBSCRIPTION_ID>/resourceGroups/<LAW_RESOURCE_GROUP>/providers/Microsoft.OperationalInsights/workspaces/<LAW_NAME>',
    startTime: '2026-12-05T09:00:00',
    columns: sample.COLUMNS.value,
    kqlBody: sample.KQL_BODY.value,
    monthOverride: sample.MONTH_OVERRIDE.value,
  },
  '03-access': {
    workflowName: 'lawexp-monthly',
    storageAccountName: '<STORAGE_ACCOUNT_NAME>',
    lawResourceId: '/subscriptions/<LAW_SUBSCRIPTION_ID>/resourceGroups/<LAW_RESOURCE_GROUP>/providers/Microsoft.OperationalInsights/workspaces/<LAW_NAME>',
  },
};

for (const [stage, parameters] of Object.entries(stages)) {
  const compiled = execFileSync('bicep', [
    'build', resolve(root, 'infra', 'customer', `${stage}.bicep`), '--stdout',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  emitJson(`customer/infra/${stage}.json`, JSON.parse(compiled));
  emitJson(`customer/infra/${stage}.parameters.json`, {
    $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
    contentVersion: '1.0.0.0',
    parameters: Object.fromEntries(Object.entries(parameters).map(([name, value]) => [name, { value }])),
  });
}

for (const [source, destination] of [
  ['logicapp/monthly-export/definition.json', 'customer/logicapp/monthly-export/definition.json'],
]) {
  emitJson(destination, JSON.parse(readFileSync(resolve(root, source), 'utf8')));
}

const settingsFiles = readdirSync(resolve(root, 'settings')).filter(name => name.endsWith('.json')).sort();
for (const name of settingsFiles) {
  const settings = JSON.parse(readFileSync(resolve(root, 'settings', name), 'utf8'));
  emitJson(`customer/settings/${name}`, settings);
  emit(`customer/settings/${name.replace(/\.json$/, '.kql')}`, `${settings.KQL_BODY.value}\n`);
  emitJson(`customer/settings/${name.replace(/\.json$/, '.csv-columns.json')}`,
    settings.COLUMNS.value.map(column => ({
      header: column, value: `@item()['${column.replaceAll("'", "''")}']`,
    })));
}

assert.deepEqual(readdirSync(resolve(root, 'customer', 'infra')).sort(),
  Object.keys(stages).flatMap(stage => [`${stage}.json`, `${stage}.parameters.json`]).sort(),
  'Remove obsolete customer infrastructure assets');
assert.deepEqual(readdirSync(resolve(root, 'customer', 'logicapp')), ['monthly-export']);
assert.deepEqual(readdirSync(resolve(root, 'customer', 'logicapp', 'monthly-export')), ['definition.json']);
assert.deepEqual(readdirSync(resolve(root, 'customer', 'settings')).sort(),
  settingsFiles.flatMap(name => [name, name.replace(/\.json$/, '.kql'), name.replace(/\.json$/, '.csv-columns.json')]).sort());
