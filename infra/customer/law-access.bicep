targetScope = 'resourceGroup'

param lawName string
param workflowResourceId string
param principalId string

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: lawName
}

resource lawRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(law.id, workflowResourceId, 'log-reader')
  scope: law
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '73c42c96-874c-492b-b04d-ab87d138a893')
  }
}

output lawRoleAssignmentId string = lawRole.id
