targetScope = 'resourceGroup'

param location string = resourceGroup().location
param vnetName string = 'lawexp-vnet'
param hostSaName string
param uamiName string = 'lawexp-host-mi'
param appName string = 'lawexp-ws'
param contentShareMode string = 'none'

resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: uamiName
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'lawexp-ws-plan'
  location: location
  sku: { name: 'WS1', tier: 'WorkflowStandard' }
  kind: 'elastic'
  properties: {
    maximumElasticWorkerCount: 1
  }
}

var baseSettings = [
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
  { name: 'WEBSITE_CONTENTOVERVNET', value: '1' }
]

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
    virtualNetworkSubnetId: resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, 'snet-integ')
    vnetRouteAllEnabled: true
    publicNetworkAccess: 'Disabled'
    siteConfig: {
      netFrameworkVersion: 'v6.0'
      alwaysOn: false
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: baseSettings
    }
  }
}

output appHost string = app.properties.defaultHostName
