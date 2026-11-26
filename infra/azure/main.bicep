targetScope = 'subscription'

@description('RG exclusivo y temporal del checkpoint; eliminarlo al finalizar.')
param resourceGroupName string
param appName string
param planName string
param location string = 'eastus'
@allowed(['F1', 'B1'])
@description('B1 solo con aprobacion explicita de costo; nunca fallback automatico.')
param sku string = 'F1'
@description('Fecha de limpieza YYYY-MM-DD. Etiqueta informativa, no elimina recursos.')
param expiresOn string
param corsOrigin string
param supabaseUrl string
@secure()
param supabaseAnonKey string
@secure()
param databaseUrl string

var tags = {
  project: 'TurnoSmart'
  lifecycle: 'checkpoint-temporary'
  expiresOn: expiresOn
}

resource group 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module backend './backend.bicep' = {
  name: 'backend'
  scope: group
  params: {
    appName: appName
    planName: planName
    location: location
    sku: sku
    tags: tags
    corsOrigin: corsOrigin
    supabaseUrl: supabaseUrl
    supabaseAnonKey: supabaseAnonKey
    databaseUrl: databaseUrl
  }
}

output url string = backend.outputs.url
