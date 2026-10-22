targetScope = 'resourceGroup'

param location string = resourceGroup().location

@minLength(3)
@maxLength(8)
@description('Lowercase letters and digits only, starting with a letter. Deploy into a NEW dedicated resource group.')
param prefix string = 'lawexp'

@allowed([30, 60, 90, 120, 180, 365, 730])
param retentionInDays int = 90

var storageName = '${toLower(prefix)}${uniqueString(resourceGroup().id)}'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    publicNetworkAccess: 'Disabled'
    allowSharedKeyAccess: false
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
      ipRules: []
      virtualNetworkRules: []
    }
    encryption: {
      keySource: 'Microsoft.Storage'
      services: {
        blob: { enabled: true }
      }
    }
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {}
}

resource exports 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'exports'
  properties: { publicAccess: 'None' }
}

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-law'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: retentionInDays
    publicNetworkAccessForQuery: 'Enabled'
    publicNetworkAccessForIngestion: 'Disabled'
  }
}

output storageAccountName string = storage.name
output lawName string = law.name
output lawResourceId string = law.id
output exportsContainerResourceId string = exports.id
