# Shared

Contratos compartidos entre frontend y backend: tipos de request y response, constantes y schemas de validación con Zod. No depende del navegador ni de la base de datos.

| Archivo           | Contenido                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `errors.ts`       | Códigos de error de la API, su status HTTP y la forma del cuerpo de error.                                       |
| `identity.ts`     | Roles, matriz de permisos (`can`), contexto autenticado, `/api/me`, onboarding y edición del negocio.            |
| `customers.ts`    | DTO de cliente, paginación y schemas de alta, edición y listado (email normalizado, teléfono validado).          |
| `appointments.ts` | Estados de turno y tipos de evento (iguales a los enums de Prisma), historial, score de riesgo y explicación IA. |

El detalle de endpoints y errores está en [docs/contracts.md](../../docs/contracts.md).

## Uso

El paquete es ESM y se consume compilado desde `dist/`:

```bash
npm run build:shared
```

`dev:frontend`, `dev:backend`, `build`, `typecheck` y `test` de la raíz lo compilan antes de usarlo. Después de cambiar algo en `src/`, volver a compilarlo si una app ya está corriendo.

Cada cambio de contrato tiene que mantener alineados el backend, el frontend y, para estados y eventos, los enums de `apps/backend/prisma/schema.prisma`.
