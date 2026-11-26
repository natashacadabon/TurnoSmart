# Infraestructura

## Desarrollo local

Requiere Node 22 de `.nvmrc`, `npm ci` inicial y Docker Desktop Linux.

```bash
npm run docker:config
npm run docker:dev
# En otra terminal, o Ctrl+C en la primera
npm run docker:down
# Detiene las apps, reinicia solo las tablas de la app y carga fixtures
npm run docker:reset
npm run docker:dev
```

Un unico Compose mantiene PostgreSQL persistente, GoTrue y su proxy para
`/auth/v1`. Frontend y backend corren en Windows con hot reload nativo, sin
polling ni volumen de node_modules Linux. Shared tiene un unico watcher.
Las dependencias se reutilizan y solo se reinstalan si cambian los manifiestos
o Node. Migraciones y seeds se ejecutan una vez antes de iniciar las apps.
No hay contenedores permanentes para tareas de preparacion.

Abrir `http://localhost:3000/login`, usuario `admin@turnosmart.test`,
password ficticia `TurnoSmartLocal2026`. Los puertos y password se pueden
configurar copiando `.env.dev.example` a `.env.dev` antes de iniciar.
Los comandos no modifican archivos `.env`. La firma Auth se conserva en
`.local/auth-secret` ignorado por Git, o reutiliza `TS_JWT_SECRET` existente.
Las credenciales cloud de la terminal no se propagan a las apps.

`docker:down` detiene apps y servicios sin borrar volumenes.
`docker:reset` opera mediante `psql` dentro del servicio PostgreSQL del
Compose: solo reinicia el schema `public` de `turnosmart_local`, aplica
migraciones y seed y apaga los servicios. Conserva cuentas Auth, password
original del administrador y otros schemas. No usa DATABASE_URL de la terminal.
El seed conserva IDs y actualiza fixtures reservados.

`docker:logs` muestra solo PostgreSQL/Auth/proxy. Los logs de las apps
estan en la terminal de `docker:dev`. Tras cambiar codigo de shared se
recompila automaticamente. Solo los puertos locales 3000, 4000, 54325 y
54326 se usan. Las conexiones Docker publicadas se limitan a loopback.

Los Dockerfiles de comprobacion Vercel/Render y del ZIP Azure tienen
consumidores documentados. Se conservan como herramientas puntuales locales
y no forman parte del arranque de desarrollo. Las imagenes y volumenes anteriores y el stack Supabase detenido se conservan.
Los contenedores huerfanos del mismo proyecto Compose se retiran al arrancar
o detener, sin borrar volumenes.

## Publicación

- [Vercel](vercel/README.md) publica el frontend mediante GitHub Actions. Preview puede seguir a CI desde `dev` y PR internas elegibles. Production se inicia por dispatch.
- [Render](render/README.md) configura el backend de Dev y el despliegue desde `dev` tras los checks. Las migraciones se aplican por separado.
- [Azure](azure/README.md) contiene Bicep, el ZIP de la API y el procedimiento manual para validar un checkpoint temporal.
- [Supabase Cron](supabase/appointment-email-cron.sql) puede invocar al procesador de correos del backend cuando haya trabajos vencidos. La configuración de Vault y Resend se documenta en la [guía de operación](../docs/operations.md#notificaciones-de-turnos).

La verificación del entorno publicado y la integración con monitoreo externo figuran en el [backlog](../docs/backlog.md).
