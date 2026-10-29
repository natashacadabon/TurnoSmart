# Tests

Las pruebas viven junto a cada app. Los comandos y requisitos están en la sección "Calidad, pruebas y CI" del README de la raíz.

## Implementado

| Tipo        | Dónde                           | Qué cubre                                                                                                                                                                                                                                                                                       |
| ----------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unitarias   | `apps/backend/test/unit`        | API completa con fakes en memoria: autenticación (401), permisos por rol (403), aislamiento entre negocios (404), onboarding, clientes (alta, edición, baja y validaciones), historial, explicación con IA (timeout, cuota, respuesta inválida, datos sensibles), CORS y errores. Corren en CI. |
| Integración | `apps/backend/test/integration` | API + PostgreSQL real con las migraciones: onboarding concurrente que crea un único negocio, persistencia y aislamiento de clientes entre dos negocios, y baja bloqueada por la FK cuando el cliente tiene turnos.                                                                              |
| End-to-end  | `apps/frontend/e2e`             | Navegador real, sin mocks: login inválido, rutas protegidas, recuperación ante una API caída y alta, recarga, edición, baja y cierre de sesión con un cliente.                                                                                                                                  |

Las pruebas de integración crean y borran negocios: usar una base descartable con las migraciones aplicadas, nunca la del equipo ni la de la demo.

## Pendiente

- Unitarias del score de riesgo, la disponibilidad y las transiciones de estado de un turno.
- Integración de reservas: dos solicitudes simultáneas al mismo horario (una sola persiste), rollback del evento y RLS con dos negocios.
- End-to-end de reserva, reprogramación y cancelación.
- Correr las pruebas de integración en CI con una base efímera.

El criterio del piloto es operar una agenda completa e identificar turnos riesgosos sin intervención técnica.
