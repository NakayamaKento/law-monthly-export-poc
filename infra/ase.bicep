targetScope = 'resourceGroup'

param location string = resourceGroup().location
param vnetName string = 'lawexp-vnet'
param aseName string = 'lawexp-ase'

resource ase 'Microsoft.Web/hostingEnvironments@2023-12-01' = {
  name: aseName
  location: location
  kind: 'ASEV3'
  properties: {
    internalLoadBalancingMode: 'Web, Publishing'
    virtualNetwork: {
      id: resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, 'snet-ase')
    }
    zoneRedundant: false
    dedicatedHostCount: 0
  }
}

output aseId string = ase.id
