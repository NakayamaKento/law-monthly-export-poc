import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const customer = resolve(root, 'customer');
const read = path => readFileSync(resolve(customer, path), 'utf8');
const json = path => JSON.parse(read(path));

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

function objects(value) {
  if (!value || typeof value !== 'object') return [];
  return [value, ...Object.values(value).flatMap(objects)];
}

function resources(stage) {
  return objects(json(`infra/${stage}.json`)).filter(value =>
    typeof value.type === 'string' && /^Microsoft\./i.test(value.type));
}

test('all delivery JSON parses and ARM parameters exactly match each template', () => {
  const paths = files(customer);
  for (const path of paths.filter(path => path.endsWith('.json'))) {
    assert.doesNotThrow(() => JSON.parse(readFileSync(path, 'utf8')), path);
  }
  for (const stage of ['01-foundation', '02-app-ws', '03-access']) {
    const template = json(`infra/${stage}.json`);
    const parameters = json(`infra/${stage}.parameters.json`);
    assert.deepEqual(Object.keys(parameters.parameters).sort(), Object.keys(template.parameters).sort());
    assert(template.resources.length > 0);
    assert(!objects(template).some(value => Object.hasOwn(value, 'templateLink')), stage);
    assert(objects(template).filter(value => value.type === 'Microsoft.Resources/deployments')
      .every(value => value.properties.mode === 'Incremental'));
  }
});

test('foundation remains private and keyless with the expected host roles and endpoints', () => {
  const foundation = resources('01-foundation');
  const storage = foundation.filter(value => value.type === 'Microsoft.Storage/storageAccounts');
  assert.equal(storage.length, 2);
  for (const account of storage) {
    assert.equal(account.properties.publicNetworkAccess, 'Disabled');
    assert.equal(account.properties.allowSharedKeyAccess, false);
    assert.equal(account.properties.allowBlobPublicAccess, false);
    assert.equal(account.properties.networkAcls.defaultAction, 'Deny');
  }
  const law = foundation.find(value => value.type === 'Microsoft.OperationalInsights/workspaces');
  assert.equal(law.properties.publicNetworkAccessForQuery, 'Disabled');
  assert.equal(law.properties.publicNetworkAccessForIngestion, 'Disabled');
  assert.equal(json('infra/01-foundation.parameters.json').parameters.retentionInDays.value, 90);
  const ampls = foundation.find(value => value.type.toLowerCase() === 'microsoft.insights/privatelinkscopes');
  assert.equal(ampls.properties.accessModeSettings.queryAccessMode, 'PrivateOnly');
  assert.equal(ampls.properties.accessModeSettings.ingestionAccessMode, 'PrivateOnly');
  const text = read('infra/01-foundation.json');
  for (const role of [
    '17d1049b-9a84-46fb-8f53-869881c3d3ab',
    'b7e6dc6d-f1e8-4753-8033-0f276bb0955b',
    '974c5e8b-45b9-4653-ba55-5f855dd0fb88',
    '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3',
  ]) assert(text.includes(role), role);
  const template = objects(json('infra/01-foundation.json')).find(value => value.variables?.hostGroups);
  assert.deepEqual(template.variables.hostGroups, ['blob', 'queue', 'table', 'file']);
  assert(foundation.some(value => value.type === 'Microsoft.Network/privateEndpoints' &&
    value.properties.privateLinkServiceConnections[0].properties.groupIds.includes("[variables('hostGroups')[copyIndex()]]")));
});

test('WS1 uses VNet integration, managed identity storage, and no content share credentials', () => {
  const appResources = resources('02-app-ws');
  const app = appResources.find(value => value.type === 'Microsoft.Web/sites');
  const plan = appResources.find(value => value.type === 'Microsoft.Web/serverfarms');
  assert.equal(plan.sku.name, 'WS1');
  assert.equal(app.properties.publicNetworkAccess, 'Disabled');
  assert.equal(app.properties.vnetRouteAllEnabled, true);
  assert(app.properties.virtualNetworkSubnetId.includes('snet-integ'));
  assert.equal(app.identity.type, 'SystemAssigned, UserAssigned');
  const subnet = appResources.find(value => value.type === 'Microsoft.Network/virtualNetworks/subnets');
  assert.equal(subnet.properties.delegations[0].properties.serviceName, 'Microsoft.Web/serverFarms');
  assert.equal(app.properties.siteConfig.appSettings, "[variables('baseSettings')]");
  const appTemplate = objects(json('infra/02-app-ws.json')).find(value => value.variables?.baseSettings);
  const settings = new Map(appTemplate.variables.baseSettings.map(value => [value.name, value.value]));
  for (const suffix of ['managedIdentityResourceId', 'blobServiceUri', 'queueServiceUri', 'tableServiceUri', 'credential']) {
    assert(settings.has(`AzureWebJobsStorage__${suffix}`), suffix);
  }
  for (const name of ['AzureWebJobsStorage', 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING', 'WEBSITE_CONTENTSHARE']) {
    assert(!settings.has(name), name);
  }
});

test('app access includes scoped data roles and the site PE with DNS integration', () => {
  const access = resources('03-access');
  const roles = access.filter(value => value.type === 'Microsoft.Authorization/roleAssignments');
  assert.equal(roles.length, 2);
  for (const role of roles) {
    assert(role.scope);
    assert(role.properties.principalId.includes('Microsoft.Web/sites'));
  }
  const text = read('infra/03-access.json');
  assert(text.includes('ba92f5b4-2d11-453d-a403-e96b0029c9fe'));
  assert(text.includes('73c42c96-874c-492b-b04d-ab87d138a893'));
  const endpoint = access.find(value => value.type === 'Microsoft.Network/privateEndpoints');
  assert.deepEqual(endpoint.properties.privateLinkServiceConnections[0].properties.groupIds, ['sites']);
  assert(access.some(value => value.type === 'Microsoft.Network/privateDnsZones' &&
    value.name === 'privatelink.azurewebsites.net'));
  assert(access.some(value => value.type === 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups'));
  assert(access.some(value => value.type === 'Microsoft.Network/privateDnsZones/virtualNetworkLinks'));
});

test('settings cover workflow references and the fixture produces the documented boundary IDs', () => {
  const sample = json('settings/sample.json');
  const values = Object.fromEntries(sample.map(value => [value.name, value.value]));
  assert.equal(sample.length, Object.keys(values).length);
  const workflow = read('logicapp/monthly-export/workflow.json');
  const referenced = [...workflow.matchAll(/appsetting\('([^']+)'\)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(referenced)].sort(), Object.keys(values).sort());
  assert.equal(values.LAW_ID, '<LOG_ANALYTICS_WORKSPACE_ID>');
  assert.equal(values.OUT_BLOB_URI, 'https://<OUTPUT_STORAGE_ACCOUNT_NAME>.blob.core.windows.net');
  assert.equal(values.COLUMNS, 'TimeGenerated,Id,Text');
  assert.equal(values.MONTH_OVERRIDE, '2026-01');
  const rows = [...values.KQL_BODY.matchAll(/datetime\(([^)]+)\),(\d+),/g)]
    .map(match => ({ time: Date.parse(match[1]), id: Number(match[2]) }));
  assert.equal(rows.length, 6);
  for (const [start, end, ids] of [
    ['2025-12-31T15:00:00Z', '2026-01-31T15:00:00Z', [2, 3, 4, 5]],
    ['2025-10-31T15:00:00Z', '2025-11-30T15:00:00Z', []],
    ['2026-01-31T15:00:00Z', '2026-02-28T15:00:00Z', [6]],
  ]) {
    assert.deepEqual(rows.filter(row => row.time >= Date.parse(start) && row.time < Date.parse(end))
      .map(row => row.id), ids);
  }
  assert(values.KQL_BODY.includes('TimeGenerated >= start and TimeGenerated < end'));
  assert(values.KQL_BODY.endsWith('project bag=pack_all()'));
  assert(values.KQL_BODY.includes('日本語') && values.KQL_BODY.includes('line1\\nline2'));
  assert.deepEqual(json('settings/azureactivity.json').map(value => value.name).sort(), ['COLUMNS', 'KQL_BODY']);
});

test('workflow output contract and code-view payloads match the existing implementation', () => {
  const workflow = json('logicapp/monthly-export/workflow.json');
  assert.deepEqual(workflow, JSON.parse(readFileSync(resolve(root, 'logicapp', 'monthly-export', 'workflow.json'), 'utf8')));
  assert.deepEqual(json('logicapp/monthly-export/definition.json'), workflow.definition);
  assert.equal(workflow.kind, 'Stateful');
  const trigger = workflow.definition.triggers.Monthly_JST_5th_0900.recurrence;
  assert.equal(trigger.frequency, 'Month');
  assert.equal(trigger.timeZone, 'Tokyo Standard Time');
  assert.deepEqual(trigger.schedule, { monthDays: [5], hours: [9], minutes: [0] });
  const actions = workflow.definition.actions.Export.actions;
  assert.equal(actions.Query.inputs.authentication.audience, 'https://api.loganalytics.io');
  assert(actions.Query.inputs.uri.startsWith('https://api.loganalytics.azure.com/'));
  assert.equal(actions.Check_Row_Cap.expression.and[0].greaterOrEquals[1], 500000);
  assert(actions.Upload_CSV.inputs.body.includes('%EF%BB%BF'));
  assert(actions.CsvText.inputs.includes("equals(outputs('RowCount'),0)"));
  assert(actions.CsvText.inputs.includes("join(outputs('Settings_Columns'),',')"));
  for (const [name, file] of [['Upload_CSV', 'export.csv'], ['Upload_Manifest', 'manifest.json']]) {
    assert(actions[name].inputs.uri.endsWith(`/runs/@{workflow().run.name}/${file}`));
    assert.equal(actions[name].inputs.authentication.audience, 'https://storage.azure.com/');
  }
  assert.deepEqual(actions.Upload_Manifest.inputs.body.files, ['export.csv']);
  assert(actions.Upload_Current.inputs.uri.endsWith('/exports/@{outputs(\'Month\')}/current.json'));
  assert.deepEqual(actions.Upload_Current.runAfter, { Upload_Manifest: ['Succeeded'] });
  assert.equal(actions.Upload_Current.inputs.body.path, "@{outputs('Month')}/runs/@{workflow().run.name}/");
});

test('delivery has no credentials, environment IDs, user paths, or external local references', () => {
  const roleIds = new Set([
    '17d1049b-9a84-46fb-8f53-869881c3d3ab', 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b',
    '974c5e8b-45b9-4653-ba55-5f855dd0fb88', '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3',
    'ba92f5b4-2d11-453d-a403-e96b0029c9fe', '73c42c96-874c-492b-b04d-ab87d138a893',
  ]);
  for (const path of files(customer)) {
    const text = readFileSync(path, 'utf8');
    assert(!/AccountKey=|SharedAccessSignature=|[?&]sig=|\blistKeys\s*\(/i.test(text), path);
    assert(!/\b[A-Za-z]:[\\/]|\.copilot[\\/]session-state|rg-poc-lawexport/i.test(text), path);
    assert(!/https:\/\/lawexp[a-z0-9]+\.blob\./i.test(text), path);
    for (const match of text.matchAll(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi)) {
      assert(roleIds.has(match[0].toLowerCase()), `Unexpected identifier in ${relative(root, path)}`);
    }
  }
});

test('all local Markdown file links remain inside the standalone delivery and resolve', () => {
  let checked = 0;
  for (const path of files(customer).filter(path => path.endsWith('.md'))) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^https?:\/\//.test(target) || target.startsWith('#')) continue;
      const linked = resolve(dirname(path), decodeURIComponent(target.split('#')[0]));
      assert(linked.startsWith(`${customer}${sep}`), `Non-delivery link: ${target}`);
      assert.doesNotThrow(() => readFileSync(linked), `Missing link: ${target}`);
      checked++;
    }
  }
  assert(checked > 20);
});
