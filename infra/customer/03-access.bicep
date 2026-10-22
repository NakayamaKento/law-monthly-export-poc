targetScope = 'resourceGroup'

param workflowName string
param storageAccountName string
param lawName string

resource workflow 'Microsoft.Logic/workflows@2019-05-01' existing = {
  name: workflowName
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource exports 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' existing = {
  name: '${storage.name}/default/exports'
}

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: lawName
}

resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(exports.id, workflow.id, 'blob-contributor')
  scope: exports
  properties: {
    principalId: workflow.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  }
}

resource lawRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(law.id, workflow.id, 'log-reader')
  scope: law
  properties: {
    principalId: workflow.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '73c42c96-874c-492b-b04d-ab87d138a893')
  }
}

output blobRoleAssignmentId string = blobRole.id
output lawRoleAssignmentId string = lawRole.id
