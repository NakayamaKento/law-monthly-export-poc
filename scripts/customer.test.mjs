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
const settingNames = ['sample', 'azureactivity', 'azureactivity-failures', 'azureactivity-summary', 'perf-cpu-daily'];
const stages = ['01-foundation', '02-workflow', '03-access'];

function definitionForPattern(name) {
  const workflow = structuredClone(definition);
  workflow.actions.Export.actions.Create_CSV_table.inputs.columns = delivered(`settings/${name}.csv-columns.json`);
  return workflow;
}

function storedRun(result) {
  const { workflowName, month } = result.outputs.Manifest;
  const current = JSON.parse(result.blobs.get(`/exports/${workflowName}/${month}/current.json`));
  assert.deepEqual(current, result.outputs.Current);
  const manifest = JSON.parse(result.blobs.get(`/exports/${current.path}manifest.json`));
  assert.equal(current.csvFileName, manifest.files[0]);
  const csv = result.blobs.get(`/exports/${current.path}${current.csvFileName}`);
  assert(csv, 'Current and manifest must reference an existing CSV');
  return { current, manifest, csv };
}

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
  assert.deepEqual(readdirSync(resolve(root, 'settings')).sort(), settingNames.map(name => `${name}.json`).sort());
  assert.deepEqual(readdirSync(resolve(customer, 'settings')).sort(),
    settingNames.flatMap(name => [`${name}.json`, `${name}.kql`, `${name}.csv-columns.json`]).sort());
  for (const name of settingNames) {
    assert.deepEqual(delivered(`settings/${name}.json`), json(`settings/${name}.json`));
    assert.equal(read(`customer/settings/${name}.kql`), `${json(`settings/${name}.json`).KQL_BODY.value}\n`);
    assert.deepEqual(delivered(`settings/${name}.csv-columns.json`),
      json(`settings/${name}.json`).COLUMNS.value.map(column => ({
        header: column, value: `@item()['${column.replaceAll("'", "''")}']`,
      })));
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
  assert(workflow.properties.definition.includes("variables('csvColumns')"));
  const csvColumns = template.variables.copy.find(copy => copy.name === 'csvColumns');
  assert.equal(csvColumns.count, "[length(parameters('columns'))]");
  assert.equal(csvColumns.input.header, "[parameters('columns')[copyIndex('csvColumns')]]");
  assert.equal(csvColumns.input.value,
    "[format('@item()[''{0}'']', replace(parameters('columns')[copyIndex('csvColumns')], '''', ''''''))]");
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
  for (const name of settingNames) {
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

test('customer KQL patterns keep the monthly window and match their documented output columns', () => {
  const guide = read('customer/docs/query-patterns.md');
  for (const name of settingNames.filter(name => name !== 'sample')) {
    const settings = json(`settings/${name}.json`);
    const kql = settings.KQL_BODY.value;
    assert.equal(settings.MONTH_OVERRIDE.value, '');
    const table = name === 'perf-cpu-daily' ? 'Perf' : 'AzureActivity';
    assert(kql.startsWith(`${table}\n| where TimeGenerated >= start and TimeGenerated < end\n`));
    assert(!/\b(?:ago|now|startofmonth)\s*\(|let\s+(?:start|end)\s*=/i.test(kql));
    assert(kql.endsWith(`| project ${settings.COLUMNS.value.join(', ')}\n| project bag=pack_all()`));
    assert(guide.includes(`../settings/${name}.kql`));
    assert(guide.includes(`../settings/${name}.json`));
    assert(guide.includes(`../settings/${name}.csv-columns.json`));
    assert(guide.includes(JSON.stringify(settings.COLUMNS.value)));
  }
  assert(json('settings/azureactivity-failures.json').KQL_BODY.value.includes('| where ActivityStatusValue =~ "Failed"'));
  assert(json('settings/azureactivity-summary.json').KQL_BODY.value.includes(
    '| summarize RecordCount=count() by OperationNameValue, ActivityStatusValue'));
  const perf = json('settings/perf-cpu-daily.json');
  assert(perf.KQL_BODY.value.includes('| where CounterName == "% Processor Time"'));
  assert(perf.KQL_BODY.value.includes(
    '| summarize AvgCounterValue=avg(CounterValue) by _ResourceId, Computer, bin(TimeGenerated, 1d)'));
  assert.deepEqual(perf.COLUMNS.value, ['TimeGenerated', '_ResourceId', 'Computer', 'AvgCounterValue']);
});

test('offline WDL harness accepts each pattern response shape and rejects stale columns', () => {
  const fixtures = {
    azureactivity: { TimeGenerated: '2026-01-15T03:04:05Z', OperationNameValue: 'sample/write', ActivityStatusValue: 'Succeeded', CategoryValue: 'Administrative' },
    'azureactivity-failures': { TimeGenerated: '2026-01-15T03:04:05Z', OperationNameValue: 'sample/write', ActivityStatusValue: 'Failed', CategoryValue: 'Administrative' },
    'azureactivity-summary': { OperationNameValue: 'sample/write', ActivityStatusValue: 'Succeeded', RecordCount: 4 },
    'perf-cpu-daily': { AvgCounterValue: 12.5, Computer: 'sample-computer', _ResourceId: '/sample-resource', TimeGenerated: '2026-01-15T00:00:00Z' },
  };
  for (const [name, bag] of Object.entries(fixtures)) {
    const settings = json(`settings/${name}.json`);
    const workflow = definitionForPattern(name);
    for (const value of [[], [{ bag }]]) {
      const result = runWorkflow(workflow, settings, {
        now: '2026-02-05T00:00:00Z', queryResponse: { value },
      });
      assert.equal(result.status, 'Succeeded', result.error?.stack);
      assert.equal(result.outputs.RowCount, value.length);
      assert.equal(result.outputs.StartUtc, '2025-12-31T15:00:00');
      assert.equal(result.outputs.EndUtc, '2026-01-31T15:00:00');
      assert.equal(result.outputs.QueryText,
        `let start=datetime(2025-12-31T15:00:00); let end=datetime(2026-01-31T15:00:00); ${settings.KQL_BODY.value}`);
      const { csv: bytes, manifest } = storedRun(result);
      assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
      assert(bytes.subarray(3).toString('utf8').startsWith(`${settings.COLUMNS.value.join(',')}\r\n`));
      assert.equal(manifest.rowCount, value.length);
      if (name.endsWith('summary') && value.length) {
        assert(bytes.toString('utf8').includes('sample/write,Succeeded,4'));
        assert.equal(manifest.rowCount, 1, 'rowCount counts CSV rows, not source logs');
      }
      if (name === 'perf-cpu-daily' && value.length) {
        assert.equal(bytes.subarray(3).toString('utf8'),
          'TimeGenerated,_ResourceId,Computer,AvgCounterValue\r\n2026-01-15T00:00:00Z,/sample-resource,sample-computer,12.5\r\n');
      }
    }
    settings.COLUMNS.value = sample.COLUMNS.value;
    const invalid = runWorkflow(workflow, settings, { queryResponse: { value: [{ bag }] } });
    assert.equal(invalid.status, 'Failed');
    assert(!invalid.trace.includes('Upload_CSV'));
  }
});

test('all patterns calculate 28/29/30/31-day previous months and year rollover without edits', () => {
  const cases = [
    ['2026-02-05T00:00:00Z', '2025-12-31T15:00:00', '2026-01-31T15:00:00', 31],
    ['2026-03-05T00:00:00Z', '2026-01-31T15:00:00', '2026-02-28T15:00:00', 28],
    ['2028-03-05T00:00:00Z', '2028-01-31T15:00:00', '2028-02-29T15:00:00', 29],
    ['2026-05-05T00:00:00Z', '2026-03-31T15:00:00', '2026-04-30T15:00:00', 30],
    ['2026-01-05T00:00:00Z', '2025-11-30T15:00:00', '2025-12-31T15:00:00', 31],
  ];
  for (const name of settingNames) {
    const settings = json(`settings/${name}.json`);
    settings.MONTH_OVERRIDE.value = '';
    for (const [now, start, end, days] of cases) {
      const result = runWorkflow(definitionForPattern(name), settings, { now, queryResponse: { value: [] } });
      assert.equal(result.status, 'Succeeded', result.error?.stack);
      assert.equal(result.outputs.StartUtc, start);
      assert.equal(result.outputs.EndUtc, end);
      assert.equal((Date.parse(`${end}Z`) - Date.parse(`${start}Z`)) / 86400000, days);
    }
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
  assert.deepEqual(actions.Create_CSV_table.inputs.columns, delivered('settings/sample.csv-columns.json'));
  assert.deepEqual(actions.Upload_CSV.runAfter, { Check_Header: ['Succeeded'] });
  assert.deepEqual(definition.actions.Fail_if_Export_Failed.runAfter, { Export: ['Failed', 'TimedOut'] });
  const sequence = Object.entries(actions);
  for (let index = 0; index < sequence.length; index++) {
    assert.deepEqual(sequence[index][1].runAfter, index === 0 ? {} : { [sequence[index - 1][0]]: ['Succeeded'] },
      `${sequence[index][0]} must run only after its predecessor succeeded`);
  }
});

test('CSV uses configured column order even when bag keys arrive in different orders', () => {
  const result = runWorkflow(definition, sample, {
    queryResponse: {
      value: [
        { bag: { Text: 'comma, quote " and 日本語', Id: 2, TimeGenerated: '2026-01-01T00:00:00Z' } },
        { bag: JSON.stringify({ Id: 3, Extra: 'not exported', Text: 'line1\nline2', TimeGenerated: '2026-01-02T00:00:00Z' }) },
      ],
    },
  });
  assert.equal(result.status, 'Succeeded', result.error?.stack);
  const bytes = storedRun(result).csv;
  assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.equal(bytes.subarray(3).toString('utf8'),
    'TimeGenerated,Id,Text\r\n2026-01-01T00:00:00Z,2,"comma, quote "" and 日本語"\r\n2026-01-02T00:00:00Z,3,"line1\nline2"\r\n');
  assert.equal(result.outputs.Manifest.rowCount, 2);
});

test('each pattern exports values in its explicit column order, not input key order', () => {
  for (const name of settingNames) {
    const settings = json(`settings/${name}.json`);
    const workflow = definitionForPattern(name);
    const columns = settings.COLUMNS.value;
    const bag = Object.fromEntries(columns.map((column, index) => [column, `value-${index}`]).reverse());
    for (const month of ['2026-01', '2026-02']) {
      settings.MONTH_OVERRIDE.value = month;
      const result = runWorkflow(workflow, settings, { queryResponse: { value: [{ bag }] } });
      assert.equal(result.status, 'Succeeded', result.error?.stack);
      assert.equal(storedRun(result).csv.subarray(3).toString('utf8'),
        `${columns.join(',')}\r\n${columns.map((_, index) => `value-${index}`).join(',')}\r\n`);
    }
    const mismatched = structuredClone(workflow);
    mismatched.actions.Export.actions.Create_CSV_table.inputs.columns.reverse();
    const invalid = runWorkflow(mismatched, settings, { queryResponse: { value: [{ bag }] } });
    assert.equal(invalid.status, 'Failed');
    assert(!invalid.trace.includes('Upload_CSV'));
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
  assert(actions.OutputNames.inputs.runFolder.includes('/runs/'));
  assert.equal(actions.Upload_Current.inputs.queries.folderPath, "/exports/@{workflow().name}/@{outputs('Month')}");
  for (const name of ['Upload_CSV', 'Upload_Manifest']) {
    assert.equal(actions[name].inputs.queries.folderPath,
      "/exports/@{outputs('OutputNames')['runFolder']}");
  }
  assert.equal(actions.Upload_CSV.inputs.queries.name, "@outputs('OutputNames')['csvFileName']");
  assert.equal(actions.Current.inputs.path, "@concat(outputs('OutputNames')['runFolder'],'/')");
  assert.equal(actions.Current.inputs.csvFileName, "@outputs('OutputNames')['csvFileName']");
  assert.deepEqual(actions.Manifest.inputs.files, ["@outputs('OutputNames')['csvFileName']"]);
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
    const { csv: bytes, manifest } = storedRun(result);
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
    assert.equal(manifest.rowCount, count);
    assert.equal(manifest.workflowName, 'lawexp-monthly');
    assert.equal(manifest.csvReadBackVerified, true);
    assert.deepEqual(JSON.parse(result.blobs.get(`/exports/lawexp-monthly/${month}/current.json`)), {
      workflowName: 'lawexp-monthly', runId: 'run-1',
      path: `lawexp-monthly/${month}/runs/20260305-090000-JST_run-1/`,
      csvFileName: `lawexp-monthly_${month}_20260305-090000-JST.csv`,
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
  for (const result of [normal, again]) {
    assert(again.blobs.has(`/exports/${result.outputs.Current.path}${result.outputs.Current.csvFileName}`));
  }
  assert.equal(JSON.parse(again.blobs.get('/exports/lawexp-monthly/2026-01/current.json')).runId, 'run-2');
});

test('different KQL workflows share storage without mixing CSV, manifest or current', () => {
  const blobs = new Map();
  const cpuSettings = json('settings/perf-cpu-daily.json');
  const activitySettings = json('settings/azureactivity.json');
  const cpuWorkflow = definitionForPattern('perf-cpu-daily');
  const activityWorkflow = definitionForPattern('azureactivity');
  const cpuName = 'lawexp-perf-cpu';
  const activityName = 'lawexp-activity';
  const common = { blobs, now: '2026-02-05T00:00:00Z', runId: 'same-run-id' };
  const cpu = runWorkflow(cpuWorkflow, cpuSettings, {
    ...common, workflowName: cpuName,
    queryResponse: { value: [{ bag: { AvgCounterValue: 12.5, Computer: 'sample-computer', _ResourceId: '/sample-resource', TimeGenerated: '2026-01-15T00:00:00Z' } }] },
  });
  assert.equal(cpu.status, 'Succeeded', cpu.error?.stack);
  const activity = runWorkflow(activityWorkflow, activitySettings, {
    ...common, workflowName: activityName,
    queryResponse: { value: [{ bag: { CategoryValue: 'Administrative', ActivityStatusValue: 'Succeeded', OperationNameValue: 'sample/write', TimeGenerated: '2026-01-15T00:00:00Z' } }] },
  });
  assert.equal(activity.status, 'Succeeded', activity.error?.stack);
  assert.equal(blobs.size, 6);
  for (const [workflowName, settings] of [[cpuName, cpuSettings], [activityName, activitySettings]]) {
    const current = JSON.parse(blobs.get(`/exports/${workflowName}/2026-01/current.json`));
    assert.deepEqual(current, {
      workflowName, runId: 'same-run-id',
      path: `${workflowName}/2026-01/runs/20260205-090000-JST_same-run-id/`,
      csvFileName: `${workflowName}_2026-01_20260205-090000-JST.csv`,
    });
    const manifest = JSON.parse(blobs.get(`/exports/${current.path}manifest.json`));
    assert.equal(manifest.workflowName, workflowName);
    assert.equal(manifest.runId, current.runId);
    assert.equal(manifest.rowCount, 1);
    assert.equal(manifest.csvReadBackVerified, true);
    assert.deepEqual(manifest.files, [current.csvFileName]);
    assert(blobs.get(`/exports/${current.path}${current.csvFileName}`).subarray(3).toString('utf8')
      .startsWith(`${settings.COLUMNS.value.join(',')}\r\n`));
  }
  const activityBefore = new Map([...blobs].filter(([path]) => path.startsWith(`/exports/${activityName}/`)));
  const zero = runWorkflow(cpuWorkflow, cpuSettings, {
    ...common, workflowName: cpuName, runId: 'zero-run', queryResponse: { value: [] },
  });
  assert.equal(zero.status, 'Succeeded', zero.error?.stack);
  assert.equal(storedRun(zero).csv.subarray(3).toString('utf8'),
    `${cpuSettings.COLUMNS.value.join(',')}\r\n`);
  assert(blobs.has(`/exports/${cpu.outputs.Current.path}${cpu.outputs.Current.csvFileName}`));
  const cpuCurrent = blobs.get(`/exports/${cpuName}/2026-01/current.json`);
  const failed = runWorkflow(cpuWorkflow, cpuSettings, {
    ...common, workflowName: cpuName, runId: 'failed-run', queryResponse: { value: [] }, failAction: 'Upload_Manifest',
  });
  assert.equal(failed.status, 'Failed');
  assert.deepEqual(blobs.get(`/exports/${cpuName}/2026-01/current.json`), cpuCurrent);
  const nextMonth = runWorkflow(cpuWorkflow, cpuSettings, {
    ...common, workflowName: cpuName, now: '2026-03-05T00:00:00Z', queryResponse: { value: [] },
  });
  assert.equal(nextMonth.status, 'Succeeded', nextMonth.error?.stack);
  assert(blobs.has(`/exports/${cpuName}/2026-02/current.json`));
  assert.deepEqual(blobs.get(`/exports/${cpuName}/2026-01/current.json`), cpuCurrent);
  assert.deepEqual(new Map([...blobs].filter(([path]) => path.startsWith(`/exports/${activityName}/`))), activityBefore);
  for (const stage of ['02-workflow', '03-access']) {
    assert(!delivered(`infra/${stage}.json`).resources.some(resource => resource.type.startsWith('Microsoft.Storage/')),
      'Additional KQL stages must reuse the existing Storage and container');
  }
});

test('readable names use one start-time snapshot in JST, including day and month rollover', () => {
  const cases = [
    ['2026-10-26T14:21:01Z', '2026-10-26T15:00:01Z', '20261026-232101-JST', '2026-09'],
    ['2026-12-31T14:59:59Z', '2026-12-31T15:00:01Z', '20261231-235959-JST', '2026-11'],
  ];
  for (const [startedAt, completedAt, stamp, month] of cases) {
    let clockReads = 0;
    const settings = json('settings/perf-cpu-daily.json');
    const result = runWorkflow(definitionForPattern('perf-cpu-daily'), settings, {
      workflowName: 'lawexp-perf-cpu', runId: 'run-a', queryResponse: { value: [] },
      now: () => clockReads++ === 0 ? startedAt : completedAt,
    });
    assert.equal(result.status, 'Succeeded', result.error?.stack);
    assert.equal(clockReads, 2, 'Only run start and completion may read the clock');
    assert.equal(result.outputs.Month, month);
    const { current, manifest } = storedRun(result);
    const csvName = `lawexp-perf-cpu_${month}_${stamp}.csv`;
    const path = `lawexp-perf-cpu/${month}/runs/${stamp}_run-a/`;
    assert.equal(current.path, path);
    assert.equal(current.csvFileName, csvName);
    assert.deepEqual(manifest.files, [csvName]);
    assert.equal(manifest.startedAtUtc, startedAt);
    assert.equal(manifest.completedAtUtc, completedAt);
    assert.equal(manifest.runId, 'run-a');
    assert(result.blobs.has(`/exports/${path}${csvName}`));
    assert(!csvName.includes('run-a'), 'CSV file names must not contain the execution ID');
    assert(!result.blobs.has(`/exports/${path}export.csv`));
  }
});

test('same-second runs keep both CSVs despite sharing a readable file name', () => {
  const options = { now: '2026-10-26T14:21:01Z', workflowName: 'lawexp-perf-cpu', queryResponse: { value: [] } };
  const settings = json('settings/perf-cpu-daily.json');
  const workflow = definitionForPattern('perf-cpu-daily');
  const first = runWorkflow(workflow, settings, { ...options, runId: 'run-a' });
  assert.equal(first.status, 'Succeeded', first.error?.stack);
  const firstStored = storedRun(first);
  const again = runWorkflow(workflow, settings, { ...options, runId: 'run-b', blobs: first.blobs });
  assert.equal(again.status, 'Succeeded', again.error?.stack);
  const againStored = storedRun(again);
  assert.equal(firstStored.current.csvFileName, againStored.current.csvFileName);
  assert.notEqual(firstStored.current.path, againStored.current.path);
  assert.equal(againStored.current.runId, 'run-b');
  assert(again.blobs.has(`/exports/${firstStored.current.path}${firstStored.current.csvFileName}`));
  assert(again.blobs.has(`/exports/${againStored.current.path}${againStored.current.csvFileName}`));
  assert.equal(again.blobs.size, 5);
});

test('workflow-specific publication leaves legacy names and month-only blobs untouched', () => {
  const legacy = new Map([
    ['/exports/2026-01/current.json', Buffer.from('legacy current')],
    ['/exports/2026-01/runs/run-1/export.csv', Buffer.from('legacy csv')],
    ['/exports/2026-01/runs/run-1/manifest.json', Buffer.from('legacy manifest')],
    ['/exports/lawexp-monthly/2026-01/runs/run-1/export.csv', Buffer.from('previous workflow-scoped csv')],
    ['/exports/lawexp-monthly/2026-01/runs/run-1/manifest.json', Buffer.from('previous workflow-scoped manifest')],
  ]);
  const result = runWorkflow(definition, sample, { blobs: new Map(legacy) });
  assert.equal(result.status, 'Succeeded', result.error?.stack);
  for (const [path, bytes] of legacy) assert.deepEqual(result.blobs.get(path), bytes);
  assert(result.blobs.has('/exports/lawexp-monthly/2026-01/current.json'));
});

test('offline failure injection leaves prior current unchanged until the final publish step', () => {
  const successful = runWorkflow(definition, sample);
  assert.equal(successful.status, 'Succeeded', successful.error?.stack);
  const current = successful.blobs.get('/exports/lawexp-monthly/2026-01/current.json');
  const cases = [
    { queryResponse: { error: { code: 'PartialError' }, value: [] } },
    { queryResponse: {} },
    { queryResponse: { value: null } },
    { queryResponse: { value: [{}] } },
    { queryResponse: { value: [{ bag: null }] } },
    { queryResponse: { value: [{ bag: 'invalid json' }] } },
    { queryResponse: { value: [{ bag: { Wrong: 'column' } }] } },
    { queryResponse: { value: Array.from({ length: 500000 }, () => ({ bag: {} })) } },
    { readBack: {} },
    { readBack: { $content: Buffer.from('wrong saved bytes').toString('base64') } },
    ...['Query', 'Upload_CSV', 'Read_Back_CSV', 'Upload_Manifest', 'Upload_Current'].map(failAction => ({ failAction })),
  ];
  for (const options of cases) {
    const result = runWorkflow(definition, sample, { ...options, blobs: new Map(successful.blobs), runId: 'failed-run' });
    assert.equal(result.status, 'Failed', JSON.stringify(options).slice(0, 120));
    assert.deepEqual(result.blobs.get('/exports/lawexp-monthly/2026-01/current.json'), current);
  }
  const wrongColumns = structuredClone(sample);
  wrongColumns.COLUMNS.value = ['TimeGenerated', 'Id', 'Wrong'];
  const result = runWorkflow(definition, wrongColumns, { blobs: new Map(successful.blobs) });
  assert.equal(result.status, 'Failed');
  assert.deepEqual(result.blobs.get('/exports/lawexp-monthly/2026-01/current.json'), current);
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

test('customer guides stay within the delivery and exclude implementation history', () => {
  for (const path of files(customer).filter(path => path.endsWith('.md'))) {
    const text = readFileSync(path, 'utf8');
    assert(!/\b(?:WS1|ASE|Automation|Playwright)\b|検証専用|旧版からの移行/.test(text),
      `${relative(root, path)}: keep past approaches and provider-only traces outside customer guides`);
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      assert(!relative(customer, resolve(dirname(path), decodeURIComponent(target))).startsWith('..'),
        `${relative(root, path)}: link outside customer delivery`);
    }
  }
  const snippet = read('customer/docs/validation.md').match(/```kusto\r?\n([\s\S]*?)```/);
  assert(snippet, 'Dummy test instructions must include the KQL to paste');
  const kqlTokens = query => query.match(/"(?:\\.|[^"\\])*"|[^\s"]/g);
  assert.deepEqual(kqlTokens(snippet[1]), kqlTokens(sample.KQL_BODY.value),
    'Documented dummy KQL must match the canonical sample, allowing formatting outside strings');
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
