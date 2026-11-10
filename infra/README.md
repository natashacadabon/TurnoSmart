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

- [Vercel](vercel/README.md) publica Preview y Production desde Actions.
  [Render Dev](render/README.md) publica desde `dev` tras los checks de GitHub.

## Planificado

B07 M1Ã¢â‚¬â€œM2 preparado en [azure/README.md](azure/README.md): Bicep de RG temporal,
Plan F1 Linux/App Service Node 22, ZIP de produccion y comandos PowerShell manuales.
No se crearon recursos Azure; B1 requiere aprobacion explicita. La demo exige
preflight/what-if, despliegue manual y limpieza del RG.

- Azure App Service para backend.
- Gestion de secretos por ambiente.
- Azure Monitor o Application Insights.
- Imagenes y pipeline de produccion.

La infraestructura como codigo de Azure se reserva para checkpoints temporales.

## Plan de evolucion

1. Separar ambientes de desarrollo y produccion.
2. Activar CD en Vercel y Render con los servicios existentes.
3. Preparar una imagen de produccion para el backend.
4. Desplegar la API en Azure App Service.
5. Gestionar secretos fuera del repositorio.
6. Incorporar health checks, logs estructurados y metricas.

La configuracion de desarrollo no debe reutilizarse como imagen de produccion sin hardening.
