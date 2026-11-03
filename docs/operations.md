# Operación y demo

## Validación local

```powershell
npm ci
npm run prisma:migrate --workspace=apps/backend
npm run prisma:seed --workspace=apps/backend
npm run typecheck
npm test
```

Para probar transacciones y concurrencia contra PostgreSQL real, definir
`DATABASE_URL` y `DIRECT_URL` apuntando a una base descartable con las migraciones
aplicadas y ejecutar:

```powershell
npm run test:integration
```

## Backup

El script [backup-db.ps1](../scripts/backup-db.ps1) usa `pg_dump` en formato custom.
Debe ejecutarse con `DATABASE_URL` configurada y guardarse fuera del repositorio.
Los backups deben cifrarse y probarse mediante una restauración periódica en una
base descartable.

Para restaurar un backup, usar siempre una base de prueba independiente:

```powershell
./scripts/restore-db.ps1 `
  -BackupFile ./backups/turnosmart-YYYYMMDD-HHmmss.dump `
  -TargetDatabaseUrl $env:TEST_DATABASE_URL `
  -ConfirmRestore RESTORE_TEST_DATABASE
```

El parámetro `-ConfirmRestore RESTORE_TEST_DATABASE` evita ejecutar por accidente
una restauración destructiva sobre una base productiva.

## Recorrido de demo

1. Iniciar sesión y completar onboarding.
2. Crear un servicio y una regla de disponibilidad.
3. Crear un cliente.
4. Reservar un turno futuro.
5. Confirmarlo, reprogramarlo o cancelarlo.
6. Consultar el historial de eventos.
7. Consultar el score de riesgo y solicitar su explicación con Gemini.
8. Revisar `/health`, `/ready` y `/metrics`.

No se deben incluir tokens, notas privadas ni datos personales en capturas o logs.

## Azure Monitor

Configurar `APPLICATIONINSIGHTS_CONNECTION_STRING` únicamente en el entorno del
backend y reiniciar el proceso. Los comandos `dev` y `start` cargan el loader de
Azure Monitor OpenTelemetry antes de Express. Sin esa variable, la aplicación
continúa funcionando con logs JSON y métricas locales.
