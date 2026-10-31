targetScope = 'resourceGroup'

param workflowName string
param storageAccountName string
@description('Same existing workspace ARM resource ID used in the workflow stage. Role assignment only; the workspace settings are preserved.')
param lawResourceId string

resource workflow 'Microsoft.Logic/workflows@2019-05-01' existing = {
  name: workflowName
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource exports 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' existing = {
  name: '${storage.name}/default/exports'
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

module lawAccess 'law-access.bicep' = {
  name: 'law-access-${uniqueString(workflow.id, lawResourceId)}'
  scope: resourceGroup(split(lawResourceId, '/')[2], split(lawResourceId, '/')[4])
  params: {
    lawName: split(lawResourceId, '/')[8]
    workflowResourceId: workflow.id
    principalId: workflow.identity.principalId
  }
}

output blobRoleAssignmentId string = blobRole.id
output lawRoleAssignmentId string = lawAccess.outputs.lawRoleAssignmentId
output lawAccessDeploymentName string = lawAccess.name
