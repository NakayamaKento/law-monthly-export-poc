targetScope = 'resourceGroup'

param location string = resourceGroup().location
param workflowName string = 'lawexp-monthly'
param storageAccountName string
param lawName string

@description('Future fifth day of a month at 09:00 JST, without Z or a UTC offset. Check before enabling the workflow.')
param startTime string = '2026-12-05T09:00:00'

param columns array = ['TimeGenerated', 'Id', 'Text']
param kqlBody string = 'datatable(TimeGenerated:datetime, Id:int, Text:string)[datetime(2025-12-31T14:59:59Z),1,"before window",datetime(2025-12-31T15:00:00Z),2,"start boundary",datetime(2026-01-15T03:04:05Z),3,"comma, quote \\" and 日本語",datetime(2026-01-20T00:00:00Z),4,"line1\\nline2",datetime(2026-01-31T14:59:59Z),5,"end boundary last",datetime(2026-01-31T15:00:00Z),6,"next month first"] | where TimeGenerated >= start and TimeGenerated < end | project TimeGenerated, Id, Text | project bag=pack_all()'

@description('Use 2026-01 for the four-row sample, 2025-11 for zero rows, 2026-02 for one row; clear for production.')
param monthOverride string = '2026-01'

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: lawName
}

var monitorApiId = subscriptionResourceId('Microsoft.Web/locations/managedApis', location, 'azuremonitorlogs')
var blobApiId = subscriptionResourceId('Microsoft.Web/locations/managedApis', location, 'azureblob')

// Consumption MI fields are documented at https://learn.microsoft.com/azure/logic-apps/authenticate-with-managed-identity but absent from Bicep's connection type.
resource monitor 'Microsoft.Web/connections@2016-06-01' = {
  name: '${workflowName}-logs'
  location: location
  #disable-next-line BCP187
  kind: 'V1'
  properties: {
    displayName: 'Log Analytics system managed identity'
    api: {
      id: monitorApiId
    }
    #disable-next-line BCP089
    parameterValueSet: {
      name: 'managedIdentityAuth'
      values: {}
    }
  }
}

resource blob 'Microsoft.Web/connections@2016-06-01' = {
  name: '${workflowName}-blob'
  location: location
  #disable-next-line BCP187
  kind: 'V1'
  properties: {
    displayName: 'Blob Storage system managed identity'
    api: {
      id: blobApiId
    }
    #disable-next-line BCP089
    parameterValueSet: {
      name: 'managedIdentityAuth'
      values: {}
    }
  }
}

var definition = loadJsonContent('../../logicapp/monthly-export/definition.json')
var csvColumns = [for column in columns: {
  header: column
  value: '@item()[\'${replace(column, '\'', '\'\'')}\']'
}]

resource workflow 'Microsoft.Logic/workflows@2019-05-01' = {
  name: workflowName
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    state: 'Disabled'
    definition: union(definition, {
      actions: {
        Export: {
          actions: {
            Create_CSV_table: {
              inputs: {
                columns: csvColumns
              }
            }
          }
        }
      }
      triggers: {
        Monthly_JST_5th_0900: union(definition.triggers.Monthly_JST_5th_0900, {
          recurrence: union(definition.triggers.Monthly_JST_5th_0900.recurrence, {
            startTime: startTime
          })
        })
      }
    })
    parameters: {
      COLUMNS: { value: columns }
      KQL_BODY: { value: kqlBody }
      MONTH_OVERRIDE: { value: monthOverride }
      LAW_RESOURCE_ID: { value: law.id }
      STORAGE_ACCOUNT_NAME: { value: storageAccountName }
      '$connections': {
        value: {
          azuremonitorlogs: {
            id: monitorApiId
            connectionId: monitor.id
            connectionName: monitor.name
            connectionProperties: {
              authentication: { type: 'ManagedServiceIdentity' }
            }
          }
          azureblob: {
            id: blobApiId
            connectionId: blob.id
            connectionName: blob.name
            connectionProperties: {
              authentication: { type: 'ManagedServiceIdentity' }
            }
          }
        }
      }
    }
  }
}

output workflowName string = workflow.name
output workflowResourceId string = workflow.id
output workflowPrincipalId string = workflow.identity.principalId
output monitorConnectionId string = monitor.id
output blobConnectionId string = blob.id
