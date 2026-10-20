targetScope = 'resourceGroup'

param location string = resourceGroup().location
param prefix string = 'lawexp'
param uniq string = uniqueString(resourceGroup().id)

var vnetName = '${prefix}-vnet'
var hostSaName = toLower('${prefix}h${uniq}')
var outSaName = toLower('${prefix}o${uniq}')

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: vnetName
  location: location
  properties: {
    addressSpace: { addressPrefixes: ['10.50.0.0/16'] }
    subnets: [
      {
        name: 'snet-ase'
        properties: {
          addressPrefix: '10.50.0.0/24'
          delegations: [
            { name: 'ase', properties: { serviceName: 'Microsoft.Web/hostingEnvironments' } }
          ]
        }
      }
      { name: 'snet-pe', properties: { addressPrefix: '10.50.1.0/24' } }
      { name: 'snet-vm', properties: { addressPrefix: '10.50.2.0/24' } }
      { name: 'AzureBastionSubnet', properties: { addressPrefix: '10.50.3.0/26' } }
    ]
  }
}

var zoneNames = [
  'privatelink.blob.${environment().suffixes.storage}'
  'privatelink.queue.${environment().suffixes.storage}'
  'privatelink.table.${environment().suffixes.storage}'
  'privatelink.file.${environment().suffixes.storage}'
  'privatelink.monitor.azure.com'
  'privatelink.oms.opinsights.azure.com'
  'privatelink.ods.opinsights.azure.com'
  'privatelink.agentsvc.azure-automation.net'
]

resource zones 'Microsoft.Network/privateDnsZones@2020-06-01' = [for z in zoneNames: {
  name: z
  location: 'global'
}]

resource zoneLinks 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = [for (z, i) in zoneNames: {
  parent: zones[i]
  name: 'link-${vnetName}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnet.id }
  }
}]

resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-host-mi'
  location: location
}

resource hostSa 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: hostSaName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowSharedKeyAccess: false
    allowBlobPublicAccess: false
    publicNetworkAccess: 'Disabled'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    defaultToOAuthAuthentication: true
    networkAcls: { defaultAction: 'Deny', bypass: 'None' }
  }
}

resource outSa 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: outSaName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowSharedKeyAccess: false
    allowBlobPublicAccess: false
    publicNetworkAccess: 'Disabled'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    defaultToOAuthAuthentication: true
    networkAcls: { defaultAction: 'Deny', bypass: 'None' }
  }
}

resource hostBlobSvc 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: outSa
  name: 'default'
}

resource outContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: hostBlobSvc
  name: 'exports'
  properties: { publicAccess: 'None' }
}

var hostGroups = ['blob', 'queue', 'table', 'file']
var hostZoneIdx = { blob: 0, queue: 1, table: 2, file: 3 }

resource hostPes 'Microsoft.Network/privateEndpoints@2023-11-01' = [for g in hostGroups: {
  name: '${hostSaName}-${g}-pe'
  location: location
  properties: {
    subnet: { id: '${vnet.id}/subnets/snet-pe' }
    privateLinkServiceConnections: [
      {
        name: 'c'
        properties: { privateLinkServiceId: hostSa.id, groupIds: [g] }
      }
    ]
  }
}]

resource hostPeDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = [for (g, i) in hostGroups: {
  parent: hostPes[i]
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      { name: 'z', properties: { privateDnsZoneId: zones[hostZoneIdx[g]].id } }
    ]
  }
}]

resource outPe 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: '${outSaName}-blob-pe'
  location: location
  properties: {
    subnet: { id: '${vnet.id}/subnets/snet-pe' }
    privateLinkServiceConnections: [
      { name: 'c', properties: { privateLinkServiceId: outSa.id, groupIds: ['blob'] } }
    ]
  }
}

resource outPeDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: outPe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      { name: 'z', properties: { privateDnsZoneId: zones[0].id } }
    ]
  }
}

var roleIds = [
  '17d1049b-9a84-46fb-8f53-869881c3d3ab' // Storage Account Contributor
  'b7e6dc6d-f1e8-4753-8033-0f276bb0955b' // Storage Blob Data Owner
  '974c5e8b-45b9-4653-ba55-5f855dd0fb88' // Storage Queue Data Contributor
  '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3' // Storage Table Data Contributor
]

resource hostRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for r in roleIds: {
  name: guid(hostSa.id, uami.id, r)
  scope: hostSa
  properties: {
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', r)
  }
}]

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-law'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    publicNetworkAccessForIngestion: 'Disabled'
    publicNetworkAccessForQuery: 'Disabled'
  }
}

resource ampls 'microsoft.insights/privateLinkScopes@2021-07-01-preview' = {
  name: '${prefix}-ampls'
  location: 'global'
  properties: {
    accessModeSettings: {
      ingestionAccessMode: 'PrivateOnly'
      queryAccessMode: 'PrivateOnly'
    }
  }
}

resource amplsScope 'microsoft.insights/privateLinkScopes/scopedResources@2021-07-01-preview' = {
  parent: ampls
  name: 'law'
  properties: { linkedResourceId: law.id }
}

resource amplsPe 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: '${prefix}-ampls-pe'
  location: location
  dependsOn: [amplsScope]
  properties: {
    subnet: { id: '${vnet.id}/subnets/snet-pe' }
    privateLinkServiceConnections: [
      { name: 'c', properties: { privateLinkServiceId: ampls.id, groupIds: ['azuremonitor'] } }
    ]
  }
}

resource amplsPeDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: amplsPe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      { name: 'monitor', properties: { privateDnsZoneId: zones[4].id } }
      { name: 'oms', properties: { privateDnsZoneId: zones[5].id } }
      { name: 'ods', properties: { privateDnsZoneId: zones[6].id } }
      { name: 'agentsvc', properties: { privateDnsZoneId: zones[7].id } }
      { name: 'blob', properties: { privateDnsZoneId: zones[0].id } }
    ]
  }
}

output vnetId string = vnet.id
output hostSaName string = hostSa.name
output outSaName string = outSa.name
output uamiId string = uami.id
output lawId string = law.id
output lawCustomerId string = law.properties.customerId
