targetScope = 'resourceGroup'

param location string = resourceGroup().location

@minLength(3)
@maxLength(8)
@description('Use lowercase letters and digits, starting with a letter.')
param prefix string = 'lawexp'

@allowed([30, 60, 90, 120, 180, 365, 730])
param retentionInDays int = 90

module foundation '../foundation.bicep' = {
  name: '${deployment().name}-base'
  params: {
    location: location
    prefix: prefix
    retentionInDays: retentionInDays
    hostingMode: 'ws'
    privateLogAnalytics: false
    separateOutputStorage: false
  }
}

output vnetName string = '${prefix}-vnet'
output hostSaName string = foundation.outputs.hostSaName
output outSaName string = foundation.outputs.outSaName
output uamiName string = '${prefix}-host-mi'
output lawName string = '${prefix}-law'
output lawResourceId string = foundation.outputs.lawId
output lawCustomerId string = foundation.outputs.lawCustomerId
output outBlobUri string = 'https://${foundation.outputs.outSaName}.blob.${environment().suffixes.storage}'
