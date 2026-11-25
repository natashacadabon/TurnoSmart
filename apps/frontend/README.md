# Frontend de TurnoSmart

Aplicación Next.js con App Router, React, Material UI y FullCalendar. Usa Supabase Auth para iniciar sesión y consume la API Express con contratos de `@turnosmart/shared`.

| Ruta                    | Funcionalidad                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`, `/onboarding` | Inicio de sesión y alta del negocio para una cuenta confirmada.                                                                                |
| `/`                     | Agenda de día, semana y mes en la zona del negocio, alta de turnos, indicadores diarios y evaluación de riesgo bajo demanda.                   |
| `/appointments/[id]`    | Detalle, notas, historial, acciones del personal, solicitudes de cambio y explicación con Gemini.                                              |
| `/customers`            | Búsqueda, alta y edición. La baja requiere OWNER o ADMIN y que el cliente carezca de turnos.                                                   |
| `/services`             | Servicios, franjas semanales y consulta de slots. STAFF tiene acceso de lectura.                                                               |
| `/settings`             | Configuración del negocio y de sus notificaciones, con vistas previas de correo. OWNER y ADMIN pueden editar.                                  |
| `/notifications`        | Historial interno, filtro de avisos sin leer y lecturas por usuario.                                                                           |
| `/turno/gestionar`      | Página pública que recibe un token en el fragmento de URL. Permite confirmar, cancelar según la política vigente o pedir un cambio de horario. |

## Desarrollo

Configurar `apps/frontend/.env.local` a partir de [la plantilla](.env.example). Usar la URL y la clave pública del mismo Supabase que consume el backend. Desde la raíz:

```sh
npm run dev:frontend
npm run test:config --workspace=apps/frontend
```

El frontend escucha en `http://localhost:3000` por defecto. En desarrollo consume `http://localhost:4000`. El entorno Docker puede ajustar este origen con `NEXT_PUBLIC_API_URL`. En un build publicado, Next.js incorpora al bundle los valores `NEXT_PUBLIC_*`. Se requieren los dos orígenes HTTPS de API y `NEXT_PUBLIC_USE_AZURE` selecciona Azure cuando vale `true`. Consultar la [guía de Vercel](../../infra/vercel/README.md) para Preview y Production y la [guía de pruebas](../../tests/README.md) para Playwright.

Los archivos bajo `src/app/(app)/` usan la sesión del personal. Las pantallas llaman a la API desde `src/lib/api.ts` y muestran los horarios en la zona del negocio. `src/app/turno/gestionar` queda fuera del layout autenticado.

## Pendientes

El [backlog](../../docs/backlog.md) reúne el trabajo pendiente, incluidos el recorrido publicado de los enlaces, la cobertura de navegador con API real y las funcionalidades de cuenta fuera del flujo actual.
