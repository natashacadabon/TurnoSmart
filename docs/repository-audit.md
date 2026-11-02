# Auditoria y limpieza — 2026-10-30

## Alcance y cambios

Revision de archivos versionados, instrucciones de `apps/frontend/AGENTS.md`,
workspaces, imports/referencias, scripts, dependencias declaradas, Docker,
Prisma, hooks, workflows y estado de A/B/C. Revision independiente del frontend
segun la instruccion de AGENTS. Sin refactorizaciones ni cambios funcionales.

### Creados

- `apps/backend/prisma/README.md`: documentacion del seed existente y de las
  cuentas locales; resuelve enlaces que ya existian en README y `.env.example`.
- `docs/repository-audit.md`: este informe.

### Modificados

- `README.md`: estado real, stack, A/B/C, estructura, instalacion, variables,
  Prisma/Supabase, cuentas locales, comandos, Docker, CI y flujo Git recomendado.
- `apps/backend/README.md`, `docs/architecture.md`, `packages/shared/README.md`:
  servicios ya implementados frente a disponibilidad/slots pendientes.
- `apps/frontend/README.md`: retiro de `public/` del arbol documentado.
- `tests/README.md`: diferencia entre integracion HTTP con fakes y PostgreSQL real.
- `.gitignore`: generados de TypeScript/Next, Vercel, reportes y claves privadas.
- `.prettierignore`: generados, reportes y entornos locales; conserva las plantillas.
- `.dockerignore`: excluye entornos de cualquier app, claves privadas, Vercel y
  artefactos de desarrollo del contexto de build; conserva las plantillas.
- `apps/frontend/.gitignore`: retiro de una repeticion de `.vercel`.
- `apps/backend/prisma.config.ts`: retiro del bloque `datasource` sin efecto en
  Prisma 6.12 y declaracion explicita de `earlyAccess: true`, que ya era el default
  de `defineConfig`. Verificados los tipos y la implementacion instalada de
  `@prisma/config`: no procesa `datasource`. Las URLs siguen en el schema intacto.

### Eliminados y evidencia

| Archivos                                                                             | Justificacion                                                                                                                                       |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/frontend/public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` | Recursos de plantilla sin referencias en codigo, CSS, docs o configuracion; sin lector dinamico de public. El workflow copia public solo si existe. |
| `apps/backend/.gitkeep`                                                              | El directorio ya contiene codigo, configuraciones y tests versionados. No hay referencias al placeholder.                                           |
| `packages/shared/.gitkeep`                                                           | El paquete ya contiene fuentes y configuracion versionadas. No hay referencias al placeholder.                                                      |
| `infra/.gitkeep`                                                                     | Docker y README ya mantienen el directorio en Git. No hay referencias al placeholder.                                                               |
| `tests/.gitkeep`                                                                     | El README conserva el directorio de estrategia de pruebas; las suites viven en las apps. No hay referencias al placeholder.                         |

No se eliminaron archivos solo por estar vacios. No se encontraron otras
eliminaciones con evidencia suficiente para este alcance.

## Conservados

- Schema, ambas migraciones y seeders; los tests y datos locales no se ejecutaron
  contra una base persistida.
- `availability.ts`, `slots.ts`, contratos de turnos y modelos aun sin endpoints:
  son bases de futuras etapas B/C, exportadas desde shared.
- `/demo`, CSS del dashboard y detalle de turno: tienen uso real o proposito
  explicito, aunque el ciclo de reservas este pendiente.
- `tests/`, `infra/`, docs de contratos/backlog, `AI-DECISIONS.md`, AGENTS y agentes:
  contienen estrategia, decisiones y trabajo futuro; no son basura generada.
- Configuraciones ESLint/TypeScript, dependencias, lockfile, hooks y workflows:
  tienen consumidores activos. No se cambiaron versiones ni manifests.
- Configuracion de ignore del frontend: conserva reglas particulares de Next y
  herramientas locales; no se elimino todo el archivo por solaparse con la raiz.

## Validaciones

Entorno disponible: Node 24.16.0, npm 11.13.0; el proyecto requiere Node 22.

| Control                                                         | Resultado                                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm ci`                                                        | Correcto, 652 paquetes instalados; auditoria npm: 0 vulnerabilidades. Advierte engine de Node. Primer intento bloqueado por EPERM; reintento fuera del sandbox correcto. |
| Formato                                                         | Prettier aplicado solo a documentos/configuracion propios para preservar cambios ajenos; `npm run format:check` global correcto.                                         |
| `npm run lint`                                                  | Correcto.                                                                                                                                                                |
| `npm run typecheck`                                             | Correcto para los tres workspaces; Prisma Client generado.                                                                                                               |
| `npm test`                                                      | 80 tests, 7 archivos, correctos.                                                                                                                                         |
| Integracion HTTP de servicios                                   | 9 tests correctos, con fakes y sin base.                                                                                                                                 |
| `npm run build`                                                 | Shared, backend y frontend correctos.                                                                                                                                    |
| `npm ls --workspaces --depth=0`                                 | Tres workspaces enlazados, sin problemas reportados.                                                                                                                     |
| `prisma:validate`                                               | Correcto con URLs ficticias locales en el proceso; sin conexiones ni migraciones.                                                                                        |
| `docker compose -f infra/docker/compose.dev.yml config --quiet` | Correcto; sin imprimir entorno resuelto ni levantar contenedores.                                                                                                        |
| Referencias y diff                                              | Sin referencias restantes a los recursos eliminados; rutas/imports compilados y enlaces locales revisados; `git diff --check` correcto.                                  |

Las primeras pruebas bajo sandbox fallaron por EACCES en sockets locales y por
falta de Prisma Client, cuya descarga estaba bloqueada por DNS. Tras habilitar
los permisos necesarios, se repitieron y pasaron. No se corrigio codigo para
ocultar esos fallos de entorno.

## Pendientes y limites

- Repetir en Node 22 para validar el entorno soportado; no se cambio el runtime.
- PostgreSQL real y E2E: requieren base descartable, servidores y credenciales de
  prueba identificados. No se ejecutaron ni se consumieron servicios Gemini/Azure.
- Docker: configuracion validada; imagenes y arranque no probados. El Compose no
  provisiona Supabase; el seed exige Supabase local separado.
- El destino Azure del workflow manual requiere `output: 'standalone'`, que aun
  no esta configurado. Se conserva por ser una etapa futura declarada.
- CI no ejecuta integracion PostgreSQL ni E2E. GitHub branch protection y un
  despliegue real no se verificaron; no se ejecutaron workflows remotos.
- Disponibilidad, slots, ciclo de reservas, calculo del riesgo y email siguen
  pendientes; B01 conserva decisiones abiertas de contratos y concurrencia.
- Habia cambios previos en `.env.example`, README, seeders, tests del seed y
  tsconfig del backend. Se preservaron; los cambios del seed aun no versionados
  no forman parte de esta limpieza. La guia describe el arbol de trabajo actual.

Commit sugerido: `chore: limpiar repositorio y actualizar documentacion`.
Sin commit, push, despliegues, cambios de schema/migraciones, ejecucion de seeders,
lectura de secretos ni borrado de datos o volumenes.
