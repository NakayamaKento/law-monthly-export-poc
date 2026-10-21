import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runWorkflow, sampleRecords } from './workflow-harness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const customer = resolve(root, 'customer');
const read = path => readFileSync(resolve(root, path), 'utf8');
const json = path => JSON.parse(read(path));
const delivered = path => json(`customer/${path}`);
const definition = json('logicapp/monthly-export/definition.json');
const actions = definition.actions.Export.actions;
const sample = json('settings/sample.json');
const stages = ['01-foundation', '02-workflow', '03-access'];

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

function resolveVariable(template, value) {
  const match = typeof value === 'string' && value.match(/^\[variables\('([^']+)'\)\]$/);
  return match ? resolveVariable(template, template.variables[match[1]]) : value;
}

test('delivery contains only the three self-contained Consumption stages and canonical payloads', () => {
  for (const stage of stages) {
    const template = delivered(`infra/${stage}.json`);
    const parameters = delivered(`infra/${stage}.parameters.json`);
    assert.deepEqual(Object.keys(parameters.parameters).sort(), Object.keys(template.parameters).sort());
    for (const parameter of Object.values(template.parameters)) {
      assert(!/\bvariables\(/.test(JSON.stringify(parameter.defaultValue)), 'ARM defaults cannot reference template variables');
    }
    assert(template.resources.length > 0);
    assert(!objects(template).some(value => value.templateLink || value.type === 'Microsoft.Resources/deployments'));
  }
  for (const path of files(customer).filter(path => path.endsWith('.json'))) {
    assert.doesNotThrow(() => JSON.parse(readFileSync(path, 'utf8')), path);
  }
  assert.deepEqual(delivered('logicapp/monthly-export/definition.json'), definition);
  for (const name of ['sample', 'azureactivity']) {
    assert.deepEqual(delivered(`settings/${name}.json`), json(`settings/${name}.json`));
  }
  const paths = ['infra', 'logicapp', 'settings', 'scripts'].flatMap(dir => files(resolve(root, dir)));
  assert(paths.every(path => !/app-ws|host\.json|connections\.json|\.ps1$|\.sh$|workflow\.json$|settings-/i.test(path)));
  const types = stages.flatMap(stage => delivered(`infra/${stage}.json`).resources.map(resource => resource.type));
  assert(types.every(type => [
    'Microsoft.Storage/storageAccounts',
    'Microsoft.Storage/storageAccounts/blobServices',
    'Microsoft.Storage/storageAccounts/blobServices/containers',
    'Microsoft.OperationalInsights/workspaces',
    'Microsoft.Logic/workflows',
    'Microsoft.Web/connections',
    'Microsoft.Authorization/roleAssignments',
  ].includes(type)), types.join(','));
});

test('foundation starts keyless and public-disabled with only a trusted-service exception', () => {
  const { resources } = delivered('infra/01-foundation.json');
  assert.equal(resources.length, 4);
  const storage = resources.filter(resource => resource.type === 'Microsoft.Storage/storageAccounts');
  assert.equal(storage.length, 1);
  const properties = storage[0].properties;
  assert.equal(properties.publicNetworkAccess, 'Disabled');
  assert.equal(properties.allowSharedKeyAccess, false);
  assert.equal(properties.allowBlobPublicAccess, false);
  assert.equal(properties.supportsHttpsTrafficOnly, true);
  assert.equal(properties.minimumTlsVersion, 'TLS1_2');
  assert.deepEqual(properties.networkAcls, {
    defaultAction: 'Deny', bypass: 'AzureServices', ipRules: [], virtualNetworkRules: [],
  });
  const container = resources.find(resource => resource.type.endsWith('/containers'));
  assert.equal(container.properties.publicAccess, 'None');
  assert(container.name.includes('exports'));
  const law = resources.find(resource => resource.type === 'Microsoft.OperationalInsights/workspaces');
  assert.equal(law.properties.publicNetworkAccessForQuery, 'Enabled');
  assert.equal(law.properties.publicNetworkAccessForIngestion, 'Disabled');
  assert.equal(delivered('infra/01-foundation.parameters.json').parameters.retentionInDays.value, 90);
});

test('Consumption uses two V1 MI connections, system identity and disabled initial workflow', () => {
  const template = delivered('infra/02-workflow.json');
  const connections = template.resources.filter(resource => resource.type === 'Microsoft.Web/connections');
  assert.equal(connections.length, 2);
  for (const connection of connections) {
    assert.equal(connection.kind, 'V1');
    assert.deepEqual(connection.properties.parameterValueSet, { name: 'managedIdentityAuth', values: {} });
    assert(!connection.properties.parameterValues);
  }
  assert(template.variables.blobApiId.includes("'azureblob'"));
  assert(template.variables.monitorApiId.includes("'azuremonitorlogs'"));
  assert(connections.some(connection => connection.properties.api.id === "[variables('blobApiId')]"));
  assert(connections.some(connection => connection.properties.api.id === "[variables('monitorApiId')]"));
  const workflow = template.resources.find(resource => resource.type === 'Microsoft.Logic/workflows');
  assert.deepEqual(workflow.identity, { type: 'SystemAssigned' });
  assert.equal(workflow.properties.state, 'Disabled');
  const params = workflow.properties.parameters;
  assert.deepEqual(Object.keys(params).sort(), Object.keys(definition.parameters).sort());
  for (const name of ['azuremonitorlogs', 'azureblob']) {
    const connection = params.$connections.value[name];
    assert.deepEqual(connection.connectionProperties.authentication, { type: 'ManagedServiceIdentity' });
    assert(connection.connectionId.includes("resourceId('Microsoft.Web/connections'"));
    assert.equal(connection.id, `[variables('${name === 'azureblob' ? 'blob' : 'monitor'}ApiId')]`);
  }
  assert(read('infra/customer/02-workflow.bicep').includes("loadJsonContent('../../logicapp/monthly-export/definition.json')"));
  assert.equal(template.parameters.kqlBody.defaultValue, sample.KQL_BODY.value);
  assert.deepEqual(template.parameters.columns.defaultValue, sample.COLUMNS.value);
  assert.equal(template.parameters.startTime.defaultValue, '2026-12-05T09:00:00');
  assert(workflow.properties.definition.includes("'startTime', parameters('startTime')"));
  assert.deepEqual(resolveVariable(template, template.variables.definition), definition);
});

test('access stage grants only container Blob Data Contributor and workspace Log Analytics Reader', () => {
  const template = delivered('infra/03-access.json');
  assert.equal(template.resources.length, 2);
  for (const role of template.resources) {
    assert.equal(role.type, 'Microsoft.Authorization/roleAssignments');
    assert.equal(role.properties.principalType, 'ServicePrincipal');
    assert(role.properties.principalId.includes("reference(resourceId('Microsoft.Logic/workflows'"));
    assert(role.properties.principalId.endsWith('.identity.principalId]'));
  }
  const blob = template.resources.find(resource => resource.properties.roleDefinitionId.includes('ba92f5b4-2d11-453d-a403-e96b0029c9fe'));
  const law = template.resources.find(resource => resource.properties.roleDefinitionId.includes('73c42c96-874c-492b-b04d-ab87d138a893'));
  assert(blob.scope.includes("Microsoft.Storage/storageAccounts/blobServices/containers"));
  assert(blob.scope.includes('exports'));
  assert(law.scope.includes('Microsoft.OperationalInsights/workspaces'));
});

test('monthly trigger is anchored in JST, serialized, and has no unsupported monthly time schedule', () => {
  const trigger = definition.triggers.Monthly_JST_5th_0900;
  assert.equal(trigger.type, 'Recurrence');
  assert.deepEqual(trigger.recurrence, {
    frequency: 'Month', interval: 1, timeZone: 'Tokyo Standard Time', startTime: '2026-12-05T09:00:00',
  });
  assert.deepEqual(trigger.runtimeConfiguration, { concurrency: { runs: 1 } });
});

test('parameters replace app settings and connectors use the Consumption $connections contract', () => {
  assert.deepEqual(Object.keys(definition.parameters).sort(),
    ['$connections', 'COLUMNS', 'KQL_BODY', 'LAW_RESOURCE_ID', 'MONTH_OVERRIDE', 'STORAGE_ACCOUNT_NAME'].sort());
  for (const name of ['sample', 'azureactivity']) {
    const settings = json(`settings/${name}.json`);
    assert.deepEqual(Object.keys(settings).sort(), Object.keys(definition.parameters).filter(key => key !== '$connections').sort());
    for (const value of Object.values(settings)) assert.deepEqual(Object.keys(value), ['value']);
    assert(Array.isArray(settings.COLUMNS.value));
    assert(settings.KQL_BODY.value.includes('TimeGenerated >= start and TimeGenerated < end'));
    assert(settings.KQL_BODY.value.endsWith('project bag=pack_all()'));
  }
  const text = JSON.stringify(definition);
  assert(!/appsetting\(|ServiceProvider|referenceName|connectionRuntimeUrl|AzureWebJobsStorage|\"type\":\"Http\"/i.test(text));
  assert.equal(actions.Query.inputs.path, '/queryDataV2');
  assert.equal(actions.Query.inputs.method, 'post');
  assert.equal(actions.Query.inputs.body.timerangetype, '3');
  assert.deepEqual(actions.Query.inputs.body.timerange, {});
  assert.equal(actions.Query.inputs.host.connection.name, "@parameters('$connections')['azuremonitorlogs']['connectionId']");
  for (const action of Object.values(actions).filter(value => value.type === 'ApiConnection' && value !== actions.Query)) {
    assert.equal(action.inputs.host.connection.name, "@parameters('$connections')['azureblob']['connectionId']");
    assert(action.inputs.path.startsWith("/v2/datasets/@{encodeURIComponent(encodeURIComponent(parameters('STORAGE_ACCOUNT_NAME')))}"));
  }
});

test('query shape, errors, row cap, bag schema and columns fail closed before upload', () => {
  assert.deepEqual(actions.Rows.inputs.schema.required, ['value']);
  assert.equal(actions.Rows.inputs.schema.properties.value.type, 'array');
  assert.deepEqual(actions.Rows.inputs.schema.properties.value.items.required, ['bag']);
  assert.deepEqual(actions.Rows.inputs.schema.properties.value.items.properties.bag.type, ['object', 'string']);
  assert.deepEqual(actions.Check_Row_Cap.expression, { and: [{ greaterOrEquals: ["@outputs('RowCount')", 500000] }] });
  assert.deepEqual(actions.Check_Record_Columns.inputs.schema.items, { type: 'object', required: "@outputs('Settings_Columns')" });
  assert.deepEqual(actions.Create_CSV_table.runAfter, { Check_Record_Columns: ['Succeeded'] });
  assert.deepEqual(actions.Upload_CSV.runAfter, { Check_Header: ['Succeeded'] });
  assert.deepEqual(definition.actions.Fail_if_Export_Failed.runAfter, { Export: ['Failed', 'TimedOut'] });
  const sequence = Object.entries(actions);
  for (let index = 0; index < sequence.length; index++) {
    assert.deepEqual(sequence[index][1].runAfter, index === 0 ? {} : { [sequence[index - 1][0]]: ['Succeeded'] },
      `${sequence[index][0]} must run only after its predecessor succeeded`);
  }
});

test('publish is ordered after saved-byte readback, with idempotent create/replace retries and no SAS', () => {
  assert.deepEqual(actions.Read_Back_CSV.runAfter, { Upload_CSV: ['Succeeded'] });
  assert.equal(actions.Read_Back_CSV.inputs.method, 'get');
  assert(actions.Read_Back_CSV.inputs.path.includes("body('Upload_CSV')['Id']"));
  assert.deepEqual(actions.Read_Back_CSV.inputs.queries, { inferContentType: false });
  assert.deepEqual(actions.Manifest.runAfter, { Check_Read_Back_CSV: ['Succeeded'] });
  assert.deepEqual(actions.Current.runAfter, { Upload_Manifest: ['Succeeded'] });
  assert.deepEqual(actions.Upload_Current.runAfter, { Current: ['Succeeded'] });
  assert.deepEqual(actions.Check_Read_Back_CSV.expression.or[1].not.equals,
    ["@body('Read_Back_CSV')?['$content']", "@base64(concat(uriComponentToString('%EF%BB%BF'),outputs('CsvText')))"]);
  for (const name of ['Upload_CSV', 'Upload_Manifest', 'Upload_Current']) {
    const action = actions[name];
    assert.equal(action.inputs.method, 'post');
    assert(action.inputs.path.endsWith('/files'));
    assert.equal(action.inputs.queries.queryParametersSingleEncoded, true);
    assert.deepEqual(action.inputs.retryPolicy, { type: 'fixed', count: 3, interval: 'PT10S' });
    assert(!Object.hasOwn(action.inputs.queries, 'overwrite'), 'CreateFile_V2 has no overwrite query parameter');
    assert.match(action.description, /replac/i);
  }
  assert(actions.Upload_CSV.inputs.queries.folderPath.includes('/runs/'));
  assert(actions.Upload_Manifest.inputs.queries.folderPath.includes('/runs/'));
  assert.equal(actions.Upload_Current.inputs.queries.folderPath, "/exports/@{outputs('Month')}");
  assert.equal(actions.Upload_Current.inputs.queries.name, 'current.json');
  assert.equal(actions.Upload_CSV.inputs.headers['Content-Type'], 'text/csv; charset=utf-8');
  assert.equal(actions.Upload_Current.inputs.headers['Content-Type'], 'application/json; charset=utf-8');
  assert(!/SharedAccessSignature|sig=|listKeys|AccountKey|access_token|https:\/\/management\.azure\.com\/subscriptions/i.test(JSON.stringify(definition)));
});

test('offline WDL harness exercises 4/0/1 monthly cases, exact boundaries, BOM, escaping and publication', () => {
  const rows = sampleRecords(sample.KQL_BODY.value);
  assert.equal(rows[2].Text, 'comma, quote " and 日本語');
  assert.equal(rows[3].Text, 'line1\nline2');
  for (const [month, count] of [['2026-01', 4], ['2025-11', 0], ['2026-02', 1]]) {
    const settings = structuredClone(sample);
    settings.MONTH_OVERRIDE.value = month;
    const result = runWorkflow(definition, settings);
    assert.equal(result.status, 'Succeeded', result.error?.stack);
    assert.equal(result.outputs.RowCount, count);
    const bytes = result.blobs.get(`/exports/${month}/runs/run-1/export.csv`);
    assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
    const csv = bytes.subarray(3).toString('utf8');
    assert(csv.startsWith('TimeGenerated,Id,Text\r\n'));
    if (count === 0) assert.equal(csv, 'TimeGenerated,Id,Text\r\n');
    if (month === '2026-01') {
      assert.equal(result.outputs.StartUtc, '2025-12-31T15:00:00');
      assert.equal(result.outputs.EndUtc, '2026-01-31T15:00:00');
      assert(csv.includes('start boundary'));
      assert(csv.includes('end boundary last'));
      assert(!csv.includes('before window'));
      assert(!csv.includes('next month first'));
      assert(csv.includes('"comma, quote "" and 日本語"'));
      assert(csv.includes('"line1\nline2"'));
    }
    const manifest = JSON.parse(result.blobs.get(`/exports/${month}/runs/run-1/manifest.json`));
    assert.equal(manifest.rowCount, count);
    assert.equal(manifest.csvReadBackVerified, true);
    assert.deepEqual(JSON.parse(result.blobs.get(`/exports/${month}/current.json`)), {
      runId: 'run-1', path: `${month}/runs/run-1/`,
    });
    assert(result.trace.indexOf('Check_Read_Back_CSV') < result.trace.indexOf('Upload_Manifest'));
  }
});

test('offline WDL harness also handles default previous month and serialized same-month reruns', () => {
  const settings = structuredClone(sample);
  settings.MONTH_OVERRIDE.value = '';
  const normal = runWorkflow(definition, settings, { now: '2026-02-05T00:00:00Z' });
  assert.equal(normal.status, 'Succeeded', normal.error?.stack);
  assert.equal(normal.outputs.Month, '2026-01');
  const again = runWorkflow(definition, sample, { blobs: normal.blobs, runId: 'run-2' });
  assert.equal(again.status, 'Succeeded', again.error?.stack);
  assert(again.blobs.has('/exports/2026-01/runs/run-1/export.csv'));
  assert(again.blobs.has('/exports/2026-01/runs/run-2/export.csv'));
  assert.equal(JSON.parse(again.blobs.get('/exports/2026-01/current.json')).runId, 'run-2');
});

test('offline failure injection leaves prior current unchanged until the final publish step', () => {
  const successful = runWorkflow(definition, sample);
  assert.equal(successful.status, 'Succeeded', successful.error?.stack);
  const current = successful.blobs.get('/exports/2026-01/current.json');
  const cases = [
    { queryResponse: { error: { code: 'PartialError' }, value: [] } },
    { queryResponse: {} },
    { queryResponse: { value: null } },
    { queryResponse: { value: [{}] } },
    { queryResponse: { value: [{ bag: null }] } },
    { queryResponse: { value: [{ bag: 'invalid json' }] } },
    { queryResponse: { value: [{ bag: { Wrong: 'column' } }] } },
    { queryResponse: { value: [{ bag: { Text: 'wrong order', Id: 1, TimeGenerated: '2026-01-01' } }] } },
    { queryResponse: { value: Array.from({ length: 500000 }, () => ({ bag: {} })) } },
    { readBack: {} },
    { readBack: { $content: Buffer.from('wrong saved bytes').toString('base64') } },
    ...['Query', 'Upload_CSV', 'Read_Back_CSV', 'Upload_Manifest', 'Upload_Current'].map(failAction => ({ failAction })),
  ];
  for (const options of cases) {
    const result = runWorkflow(definition, sample, { ...options, blobs: new Map(successful.blobs), runId: 'failed-run' });
    assert.equal(result.status, 'Failed', JSON.stringify(options).slice(0, 120));
    assert.deepEqual(result.blobs.get('/exports/2026-01/current.json'), current);
  }
  const wrongColumns = structuredClone(sample);
  wrongColumns.COLUMNS.value = ['TimeGenerated', 'Id', 'Wrong'];
  const result = runWorkflow(definition, wrongColumns, { blobs: new Map(successful.blobs) });
  assert.equal(result.status, 'Failed');
  assert.deepEqual(result.blobs.get('/exports/2026-01/current.json'), current);
  for (const columns of [[], ['Id', 'Id']]) {
    const invalid = structuredClone(sample);
    invalid.COLUMNS.value = columns;
    assert.equal(runWorkflow(definition, invalid).status, 'Failed');
  }
  const invalid = structuredClone(sample);
  invalid.KQL_BODY.value = ' ';
  assert.equal(runWorkflow(definition, invalid).status, 'Failed');
});

test('active payloads contain no environment IDs or credentials, only built-in role GUIDs', () => {
  const roles = new Set(['ba92f5b4-2d11-453d-a403-e96b0029c9fe', '73c42c96-874c-492b-b04d-ab87d138a893']);
  const paths = ['infra', 'logicapp', 'settings', 'customer/infra', 'customer/logicapp', 'customer/settings']
    .flatMap(dir => files(resolve(root, dir)));
  for (const path of paths) {
    const text = readFileSync(path, 'utf8');
    for (const guid of text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []) {
      assert(roles.has(guid.toLowerCase()), `${relative(root, path)}: environment ID`);
    }
    assert(!/AccountKey=|SharedAccessSignature=|DefaultEndpointsProtocol=|\"clientSecret\"|\"access_token\"/.test(text), path);
  }
});

test('all active documentation local links resolve without constraining wording', () => {
  const paths = [resolve(root, 'README.md'), ...files(resolve(root, 'docs')), ...files(customer)];
  for (const path of paths.filter(path => path.endsWith('.md'))) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      assert(existsSync(resolve(dirname(path), decodeURIComponent(target))), `${relative(root, path)} -> ${target}`);
    }
  }
});
