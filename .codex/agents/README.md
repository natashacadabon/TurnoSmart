# Agentes del modulo B

Configuracion creada el 2026-10-27 para Codex CLI `0.163.0-alpha.11`.
Cada TOML define `name`, `description` y `developer_instructions` conforme al
[formato oficial de agentes](https://learn.chatgpt.com/docs/agent-configuration/subagents).
Los archivos se descubren en `.codex/agents/` dentro del repositorio.
No hace falta duplicar su registro con `agents.<nombre>.config_file`.

No se crea `.codex/config.toml`: los agentes estan habilitados por defecto y no
se necesitan ajustes globales adicionales. Se conserva la configuracion del
usuario. Modelo, esfuerzo y permisos se heredan de la sesion; estos archivos no
amplian permisos ni crean un sandbox independiente. Cuatro definiciones no
implican cuatro ejecuciones simultaneas: se respetan los limites de la sesion.

## Uso

Abrir una nueva sesion de Codex en la raiz Git `TurnoSmart/TurnoSmart` para que
descubra estos archivos. Pedir explicitamente la delegacion por nombre:

| Agente                  | Ejemplo de pedido                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `backend-architect`     | Usa el subagente backend-architect para revisar la arquitectura y los DTOs del modulo B frente a B01. No edites archivos.                 |
| `scheduling-specialist` | Usa el subagente scheduling-specialist para revisar slots, UTC, zonas IANA, limites y carreras con reservas C. No edites archivos.        |
| `security-reviewer`     | Usa el subagente security-reviewer para auditar roles, aislamiento entre negocios y posibles escrituras directas que evadan Express.      |
| `test-engineer`         | Usa el subagente test-engineer para proponer pruebas locales reproducibles de B y detectar cobertura faltante, sin instalar dependencias. |

Para una revision conjunta: "Usa los cuatro subagentes del modulo B en modo
revision, espera sus resultados y consolida los hallazgos por severidad, sin
editar archivos". No es necesario activarlos a todos para cada tarea.

Para desarrollo posterior, autorizar una tarea concreta y asignar una lista
exclusiva de archivos a cada agente que vaya a editar. Las revisiones pueden
ser paralelas; si dos cambios requieren el mismo archivo, ejecutarlos en
secuencia con transferencia explicita. El agente principal integra y verifica.
`security-reviewer` se mantiene como auditor; las correcciones se delegan en otra
tarea autorizada.

## Alcance y decisiones pendientes

B01 se encuentra en `docs/api-services-availability.md`, aun marcado como
propuesta con D01-D08 pendientes. Esta solicitud fija agenda unica por negocio,
capacidad uno y comienzos cada 15 minutos; no aprueba automaticamente los otros
detalles del contrato. Los agentes deben comprobar el estado actualizado de
esas decisiones antes de implementar.

El backend actual solo expone `/health`. `packages/shared` contiene tipos de
estado de turnos y riesgo. El compose de desarrollo no incluye una base local
y backend no declara un script de tests. Estas limitaciones deben revisarse
nuevamente al comenzar cada tarea: no asumir endpoints ni pruebas existentes.

## Validacion realizada

- Los cuatro archivos se parsearon con `tomllib` de Python, sin dependencias nuevas.
- Se verificaron los tres campos obligatorios, tipos string no vacios y nombres
  unicos coincidentes con sus archivos; sin configuraciones globales duplicadas.
- `codex --strict-config doctor --json` informo `config.load: ok`. El diagnostico
  completo no fue satisfactorio por incidencias del entorno (permisos/estado,
  sandbox y conectividad); no equivale a verificar la ejecucion de estos agentes.
- `codex debug prompt-input` no pudo completar la comprobacion de descubrimiento
  por acceso denegado. Queda pendiente comprobar una invocacion en una nueva
  sesion de la aplicacion. No se ejecutaron agentes ni funcionalidades de B.

La configuracion no cambia Prisma, migraciones, infraestructura, dependencias,
secretos ni codigo funcional. No se hicieron commits ni pushes.
