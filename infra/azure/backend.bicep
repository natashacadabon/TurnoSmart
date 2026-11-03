param appName string
param planName string
param location string
@allowed(['F1', 'B1'])
param sku string = 'F1'
param tags object
param corsOrigin string
param supabaseUrl string
@secure()
param supabaseAnonKey string
@secure()
param databaseUrl string

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  kind: 'linux'
  tags: tags
  sku: {
    name: sku
    tier: sku == 'F1' ? 'Free' : 'Basic'
    capacity: 1
  }
  properties: {
    reserved: true
    perSiteScaling: false
    zoneRedundant: false
  }
}

resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  kind: 'app,linux'
  tags: tags
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: 'node dist/index.js'
      alwaysOn: false
      numberOfWorkers: 1
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      appSettings: [
        { name: 'NODE_ENV', value: 'production' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'ENABLE_ORYX_BUILD', value: 'false' }
        { name: 'CORS_ORIGIN', value: corsOrigin }
        { name: 'SUPABASE_URL', value: supabaseUrl }
        { name: 'SUPABASE_ANON_KEY', value: supabaseAnonKey }
        { name: 'DATABASE_URL', value: databaseUrl }
      ]
    }
  }
}

output url string = 'https://${app.properties.defaultHostName}'
