targetScope = 'resourceGroup'

param location string = resourceGroup().location
param vnetName string
param appName string
param outSaName string
param lawName string

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' existing = {
  name: vnetName
}

resource app 'Microsoft.Web/sites@2023-12-01' existing = {
  name: appName
}

resource outSa 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: outSaName
}

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: lawName
}

resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(outSa.id, app.id, 'blob-contributor')
  scope: outSa
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  }
}

resource lawRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(law.id, app.id, 'log-reader')
  scope: law
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '73c42c96-874c-492b-b04d-ab87d138a893')
  }
}

resource appZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.azurewebsites.net'
  location: 'global'
}

resource appZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: appZone
  name: 'link-${vnetName}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnet.id }
  }
}

resource appPe 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: '${appName}-pe'
  location: location
  properties: {
    subnet: { id: '${vnet.id}/subnets/snet-pe' }
    privateLinkServiceConnections: [
      {
        name: 'app'
        properties: {
          privateLinkServiceId: app.id
          groupIds: ['sites']
        }
      }
    ]
  }
}

resource appPeDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: appPe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      { name: 'app', properties: { privateDnsZoneId: appZone.id } }
    ]
  }
}

output appHost string = app.properties.defaultHostName
output privateEndpointName string = appPe.name
