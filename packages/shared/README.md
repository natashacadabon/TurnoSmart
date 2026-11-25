# Contratos compartidos

`@turnosmart/shared` es el workspace ESM que consume el frontend y el backend. Exporta DTO, tipos, constantes y esquemas Zod desde `src/index.ts`. Los DTO de dominio omiten `businessId` y los módulos no importan Prisma ni APIs del navegador.

| Archivo                                      | Contenido                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `identity.ts`                                | Perfiles, roles, permisos, alta y configuración del negocio, preferencias de notificaciones.   |
| `customers.ts`                               | Clientes, validaciones de entrada y paginación.                                                |
| `services.ts`, `availability.ts`, `slots.ts` | Servicios, reglas semanales, consulta de slots y grilla de 15 minutos.                         |
| `appointments.ts`                            | Turnos, proyección compatible de estados, eventos, acciones del cliente y contratos de riesgo. |
| `notifications.ts`                           | Avisos internos, paginación, lectura y tipos de vista previa de email.                         |
| `errors.ts`                                  | Códigos HTTP, errores de dominio y forma del cuerpo de error.                                  |

`AppointmentStatus` es la proyección pública que conserva `CONFIRMED`. El estado operativo persistido usa `SCHEDULED` para los turnos activos y mantiene la confirmación en un campo separado. Las horas semanales son `HH:mm` locales y los slots son instantes ISO UTC. Ver [contratos de turnos](../../docs/contracts.md#turnos) y [disponibilidad y slots](../../docs/api-services-availability.md).

## Compilación

```sh
npm run build:shared
```

La entrada del paquete apunta a `dist/`, generado e ignorado por Git. Los comandos de raíz `dev:frontend`, `dev:backend`, `typecheck`, `build`, `test` y `test:integration` lo compilan antes de consumirlo. Si las apps corren por separado, recompilar tras cambiar los contratos.
