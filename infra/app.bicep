targetScope = 'resourceGroup'

param location string = resourceGroup().location
param aseName string = 'lawexp-ase'
param aseDnsSuffix string = 'lawexp-ase.appserviceenvironment.net'
param aseInboundIp string = '10.50.0.4'
param vnetName string = 'lawexp-vnet'
param hostSaName string
param uamiName string = 'lawexp-host-mi'
param appName string = 'lawexp-la'

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' existing = {
  name: vnetName
}

resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: uamiName
}

resource zone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: aseDnsSuffix
  location: 'global'
}

resource zoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: zone
  name: 'link-${vnetName}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnet.id }
  }
}

resource recStar 'Microsoft.Network/privateDnsZones/A@2020-06-01' = {
  parent: zone
  name: '*'
  properties: { ttl: 3600, aRecords: [{ ipv4Address: aseInboundIp }] }
}

resource recAt 'Microsoft.Network/privateDnsZones/A@2020-06-01' = {
  parent: zone
  name: '@'
  properties: { ttl: 3600, aRecords: [{ ipv4Address: aseInboundIp }] }
}

resource recScm 'Microsoft.Network/privateDnsZones/A@2020-06-01' = {
  parent: zone
  name: '*.scm'
  properties: { ttl: 3600, aRecords: [{ ipv4Address: aseInboundIp }] }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'lawexp-plan'
  location: location
  kind: 'windows'
  sku: { name: 'I1v2', tier: 'IsolatedV2', size: 'I1v2', family: 'Iv2', capacity: 1 }
  properties: {
    hostingEnvironmentProfile: {
      id: resourceId('Microsoft.Web/hostingEnvironments', aseName)
    }
  }
}

resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  kind: 'functionapp,workflowapp'
  identity: {
    type: 'SystemAssigned, UserAssigned'
    userAssignedIdentities: { '${uami.id}': {} }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      netFrameworkVersion: 'v6.0'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'dotnet' }
        { name: 'APP_KIND', value: 'workflowApp' }
        { name: 'AzureFunctionsJobHost__extensionBundle__id', value: 'Microsoft.Azure.Functions.ExtensionBundle.Workflows' }
        { name: 'AzureFunctionsJobHost__extensionBundle__version', value: '[1.*, 2.0.0)' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~18' }
        { name: 'AzureWebJobsStorage__managedIdentityResourceId', value: uami.id }
        { name: 'AzureWebJobsStorage__blobServiceUri', value: 'https://${hostSaName}.blob.${environment().suffixes.storage}' }
        { name: 'AzureWebJobsStorage__queueServiceUri', value: 'https://${hostSaName}.queue.${environment().suffixes.storage}' }
        { name: 'AzureWebJobsStorage__tableServiceUri', value: 'https://${hostSaName}.table.${environment().suffixes.storage}' }
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
      ]
    }
  }
}

output appHost string = app.properties.defaultHostName
