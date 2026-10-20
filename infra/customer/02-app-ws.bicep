targetScope = 'resourceGroup'

param location string = resourceGroup().location
param vnetName string
param hostSaName string
param uamiName string
param appName string
param planName string

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' existing = {
  name: vnetName
}

resource integrationSubnet 'Microsoft.Network/virtualNetworks/subnets@2023-11-01' = {
  parent: vnet
  name: 'snet-integ'
  properties: {
    addressPrefix: '10.50.4.0/24'
    delegations: [
      {
        name: 'workflow'
        properties: {
          serviceName: 'Microsoft.Web/serverFarms'
        }
      }
    ]
  }
}

module app '../app-ws.bicep' = {
  name: '${deployment().name}-app'
  params: {
    location: location
    vnetName: vnetName
    hostSaName: hostSaName
    uamiName: uamiName
    appName: appName
    planName: planName
  }
  dependsOn: [integrationSubnet]
}

output appName string = appName
output appHost string = app.outputs.appHost
output planName string = planName
