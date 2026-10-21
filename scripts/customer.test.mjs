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

test('storage remains private and keyless while LAW uses authenticated public queries', () => {
  const foundation = resources('01-foundation');
  const storage = foundation.filter(value => value.type === 'Microsoft.Storage/storageAccounts');
  assert.equal(storage.length, 2);
  assert.equal(storage.filter(value => !value.condition).length, 1);
  assert.equal(storage.find(value => value.condition).condition, "[parameters('separateOutputStorage')]");
  for (const account of storage) {
    assert.equal(account.properties.publicNetworkAccess, 'Disabled');
    assert.equal(account.properties.allowSharedKeyAccess, false);
    assert.equal(account.properties.allowBlobPublicAccess, false);
    assert.equal(account.properties.networkAcls.defaultAction, 'Deny');
  }
  const law = foundation.find(value => value.type === 'Microsoft.OperationalInsights/workspaces');
  assert.equal(law.properties.publicNetworkAccessForQuery,
    "[if(parameters('privateLogAnalytics'), 'Disabled', 'Enabled')]");
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
  assert.equal(template.variables.hostGroups,
    "[if(equals(parameters('hostingMode'), 'ase'), createArray('blob', 'queue', 'table', 'file'), createArray('blob', 'queue', 'table'))]");
  assert(foundation.some(value => value.type === 'Microsoft.Network/privateEndpoints' &&
    value.properties.privateLinkServiceConnections[0].properties.groupIds.includes("[variables('hostGroups')[copyIndex()]]")));
});

test('WS foundation excludes Files, AMPLS, and PoC subnets while preserving the private ASE default', () => {
  const outer = json('infra/01-foundation.json');
  const deployment = outer.resources.find(value => value.type === 'Microsoft.Resources/deployments');
  assert.equal(deployment.properties.parameters.hostingMode.value, 'ws');
  assert.equal(deployment.properties.parameters.privateLogAnalytics.value, false);
  assert.equal(deployment.properties.parameters.separateOutputStorage.value, false);
  const template = deployment.properties.template;
  assert.equal(template.parameters.hostingMode.defaultValue, 'ase');
  assert.equal(template.parameters.privateLogAnalytics.defaultValue, true);
  assert.equal(template.parameters.separateOutputStorage.defaultValue, true);
  assert.equal(template.variables.outSaName,
    "[if(parameters('separateOutputStorage'), toLower(format('{0}o{1}', parameters('prefix'), parameters('uniq'))), variables('hostSaName'))]");
  assert.deepEqual(template.parameters.hostingMode.allowedValues, ['ase', 'ws']);
  assert.deepEqual(template.variables.peSubnet, {
    name: 'snet-pe', properties: { addressPrefix: '10.50.1.0/24' },
  });
  assert.deepEqual(template.variables.aseSubnets.map(value => value.name),
    ['snet-ase', 'snet-vm', 'AzureBastionSubnet']);
  const vnet = template.resources.find(value => value.type === 'Microsoft.Network/virtualNetworks');
  assert.equal(vnet.properties.subnets,
    "[if(equals(parameters('hostingMode'), 'ase'), concat(createArray(variables('peSubnet')), variables('aseSubnets')), createArray(variables('peSubnet')))]");
  assert.equal(template.variables.zoneNames,
    "[concat(variables('commonZoneNames'), if(parameters('privateLogAnalytics'), variables('monitorZoneNames'), createArray()), if(equals(parameters('hostingMode'), 'ase'), createArray(format('privatelink.file.{0}', environment().suffixes.storage)), createArray()))]");
  assert.deepEqual(template.variables.commonZoneNames, [
    "[format('privatelink.blob.{0}', environment().suffixes.storage)]",
    "[format('privatelink.queue.{0}', environment().suffixes.storage)]",
    "[format('privatelink.table.{0}', environment().suffixes.storage)]",
  ]);
  assert.deepEqual(template.variables.monitorZoneNames, [
    'privatelink.monitor.azure.com',
    'privatelink.oms.opinsights.azure.com',
    'privatelink.ods.opinsights.azure.com',
    'privatelink.agentsvc.azure-automation.net',
  ]);
  const conditionalResources = template.resources.filter(value =>
    /privateLinkScopes/i.test(value.type) || value.name.includes("-ampls"));
  assert.equal(conditionalResources.length, 4);
  for (const resource of conditionalResources) {
    assert.equal(resource.condition, "[parameters('privateLogAnalytics')]");
  }
  const dnsGroups = template.resources.filter(value =>
    value.type === 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups');
  const amplsDns = dnsGroups.find(value => value.properties.privateDnsZoneConfigs.length === 5);
  const expectedZoneNames = {
    monitor: 'privatelink.monitor.azure.com',
    oms: 'privatelink.oms.opinsights.azure.com',
    ods: 'privatelink.ods.opinsights.azure.com',
    agentsvc: 'privatelink.agentsvc.azure-automation.net',
  };
  for (const config of amplsDns.properties.privateDnsZoneConfigs) {
    assert.equal(config.properties.privateDnsZoneId,
      config.name === 'blob'
        ? "[resourceId('Microsoft.Network/privateDnsZones', variables('zoneNames')[0])]"
        : `[resourceId('Microsoft.Network/privateDnsZones', variables('zoneNames')[indexOf(variables('zoneNames'), '${expectedZoneNames[config.name]}')])]`);
  }
  const endpoints = template.resources.filter(value =>
    value.type === 'Microsoft.Network/privateEndpoints' && !value.condition);
  assert.equal(endpoints.length, 1);
  assert.equal(endpoints.filter(value => value.copy).length, 1);
  assert.equal(endpoints.find(value => value.copy).copy.count, "[length(variables('hostGroups'))]");
  const singletonGroups = endpoints.filter(value => !value.copy)
    .flatMap(value => value.properties.privateLinkServiceConnections[0].properties.groupIds);
  assert.deepEqual(singletonGroups, []);
  const outputEndpoint = template.resources.find(value =>
    value.type === 'Microsoft.Network/privateEndpoints' && value.condition === "[parameters('separateOutputStorage')]");
  assert(outputEndpoint);
  const siteEndpoints = resources('03-access').filter(value => value.type === 'Microsoft.Network/privateEndpoints');
  assert.equal(siteEndpoints.length, 1);
  assert.equal(3 + singletonGroups.length + siteEndpoints.length, 4);
  const siteZones = resources('03-access').filter(value => value.type === 'Microsoft.Network/privateDnsZones');
  assert.equal(siteZones.length, 1);
  assert.equal(template.variables.commonZoneNames.length + siteZones.length, 4);
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
  const blobRole = roles.find(value => value.properties.roleDefinitionId.includes('ba92f5b4'));
  assert(blobRole.scope.includes('/default/exports'));
  const connection = access.find(value => value.type === 'Microsoft.Web/connections');
  assert.equal(connection.kind, 'V2');
  assert.deepEqual(connection.properties.parameterValueSet, { name: 'managedIdentityAuth', values: {} });
  assert(access.some(value => value.type === 'Microsoft.Web/connections/accessPolicies' &&
    value.properties.principal.type === 'ActiveDirectory'));
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
  const workflow = read('logicapp/monthly-export/workflow.json') + read('logicapp/connections.json');
  const referenced = [...workflow.matchAll(/appsetting\('([^']+)'\)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(referenced)].sort(), Object.keys(values).sort());
  assert.equal(values.LAW_RESOURCE_ID, '<LOG_ANALYTICS_WORKSPACE_RESOURCE_ID>');
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

test('dummy-data walkthrough KQL matches the executable sample setting', () => {
  const guide = read('docs/validation.md');
  const blocks = [...guide.matchAll(/```kusto\r?\n([\s\S]*?)```/g)];
  assert.equal(blocks.length, 1);
  const normalize = value => value.replace(/\s+/g, '');
  const sample = json('settings/sample.json').find(value => value.name === 'KQL_BODY');
  assert.equal(normalize(blocks[0][1]), normalize(sample.value));
});

test('verified connector time range and settings agree with the setup guide', () => {
  const guide = read('docs/setup.md');
  const rangeType = json('logicapp/monthly-export/workflow.json').definition.actions.Export.actions.Query.inputs.body.timerangetype;
  assert.equal(rangeType, '3');
  assert(guide.includes('`timerangetype: "3"`'));
  assert(!read('logicapp/monthly-export/workflow.json').includes('SELECT_SET_IN_QUERY'));
  assert(guide.includes('2026-12-05T09:00:00'));
  assert(guide.includes('全 8 項目'));
  assert(guide.includes('exports コンテナーのみ'));
  assert(read('README.md').includes('```mermaid'));
  const wsSettings = JSON.parse(readFileSync(resolve(root, 'settings', 'settings-ws.json'), 'utf8'));
  assert.deepEqual(wsSettings, json('settings/sample.json'));
  assert(!read('infra/01-foundation.json').includes('SecurityControl'));
});

test('cleanup documentation guards existing groups and the last-app plan deletion', () => {
  const cleanup = read('docs/operations.md').split('## 5. 評価環境の後片付け')[1];
  assert(cleanup.includes('既存 RG / 既存プラン'));
  assert(cleanup.includes('関連プラン'));
  assert(cleanup.includes('削除を中止'));
  const maintenance = readFileSync(resolve(root, 'docs', 'customer-maintenance.md'), 'utf8');
  assert(maintenance.includes('deleteEmptyServerFarm=false'));
  assert(maintenance.includes('汎用リソース削除を使わない'));
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
  assert(!objects(workflow).some(value => value.type === 'Http'));
  assert.equal(actions.Query.type, 'ApiConnection');
  assert.equal(actions.Query.inputs.host.connection.referenceName, 'azuremonitorlogs');
  assert.equal(actions.Query.inputs.path, '/queryDataV2');
  assert.equal(actions.Query.inputs.body.timerangetype, '3');
  assert.deepEqual(actions.Rows.inputs.schema.required, ['value']);
  assert.equal(actions.Rows.inputs.schema.properties.value.type, 'array');
  assert.deepEqual(actions.Rows.inputs.schema.properties.value.items.required, ['bag']);
  assert(!JSON.stringify(workflow).includes('coalesce'));
  assert.equal(workflow.definition.triggers.Monthly_JST_5th_0900.runtimeConfiguration.concurrency.runs, 1);
  assert(!workflow.definition.triggers.Monthly_JST_5th_0900.evaluatedRecurrence);
  assert.equal(actions.Check_Row_Cap.expression.and[0].greaterOrEquals[1], 500000);
  assert(actions.Upload_CSV.inputs.parameters.content.includes('%EF%BB%BF'));
  assert(actions.CsvText.inputs.includes("equals(outputs('RowCount'),0)"));
  assert(actions.CsvText.inputs.includes("join(outputs('Settings_Columns'),',')"));
  for (const [name, file] of [['Upload_CSV', 'export.csv'], ['Upload_Manifest', 'manifest.json']]) {
    assert(actions[name].inputs.parameters.blobName.endsWith(`/runs/@{workflow().run.name}/${file}`));
    assert.equal(actions[name].type, 'ServiceProvider');
    assert.deepEqual(actions[name].inputs.serviceProviderConfiguration, {
      connectionName: 'AzureBlob', operationId: 'uploadBlob', serviceProviderId: '/serviceProviders/AzureBlob',
    });
    assert.equal(actions[name].inputs.parameters.containerName, 'exports');
    assert.equal(actions[name].inputs.parameters.overrideIfExists, 'true');
  }
  assert.deepEqual(actions.Manifest.inputs.files, ['export.csv']);
  assert.equal(actions.Upload_Manifest.inputs.parameters.content, "@string(outputs('Manifest'))");
  assert.equal(actions.Upload_Current.inputs.parameters.blobName, "@{outputs('Month')}/current.json");
  assert.deepEqual(actions.Current.runAfter, { Upload_Manifest: ['Succeeded'] });
  assert.deepEqual(actions.Upload_Current.runAfter, { Current: ['Succeeded'] });
  assert.equal(actions.Current.inputs.path, "@{outputs('Month')}/runs/@{workflow().run.name}/");
  const connections = json('logicapp/connections.json');
  assert.equal(connections.serviceProviderConnections.AzureBlob.parameterValues.authProvider.Type, 'ManagedServiceIdentity');
  assert.equal(connections.serviceProviderConnections.AzureBlob.parameterValues.blobStorageEndpoint, "@appsetting('OUT_BLOB_URI')");
  assert.equal(connections.serviceProviderConnections.AzureBlob.parameterValues.managedIdentityType, 'SystemAssigned');
  assert.equal(connections.managedApiConnections.azuremonitorlogs.authentication.type, 'ManagedServiceIdentity');
  assert.equal(connections.managedApiConnections.azuremonitorlogs.connectionProperties.authentication.type, 'ManagedServiceIdentity');
  assert.equal(connections.managedApiConnections.azuremonitorlogs.connectionProperties.authentication.audience,
    'https://management.core.windows.net/');
  assert.deepEqual(connections.managedApiConnections.azuremonitorlogs.connectionProperties.authentication.additionalAudiences,
    ['https://api.loganalytics.io']);
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
