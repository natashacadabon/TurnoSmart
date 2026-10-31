# Frontend - TurnoSmart

Aplicación web de TurnoSmart para la operación diaria del negocio: agenda, clientes, configuración del negocio, historial de turnos y explicación del riesgo con IA.

Construida con Next.js 16 (App Router), React 19, TypeScript, Material UI y CSS Modules.

## Pantallas

| Ruta                 | Acceso             | Contenido                                                                                                                                                                          |
| -------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                  | Sesión y negocio   | Agenda con el diseño del dashboard y datos reales: nombre del negocio, fecha y total de clientes. Turnos, riesgo y reportes aparecen vacíos hasta que exista la reserva de turnos. |
| `/demo`              | Pública            | Dashboard con datos de ejemplo.                                                                                                                                                    |
| `/login`             | Pública            | Inicio de sesión con Supabase Auth.                                                                                                                                                |
| `/onboarding`        | Sesión sin negocio | Alta del negocio; la zona horaria se detecta del navegador.                                                                                                                        |
| `/customers`         | Sesión y negocio   | Listado con búsqueda y paginación; alta y edición con errores de validación por campo; baja con confirmación (OWNER y ADMIN).                                                      |
| `/settings`          | Sesión y negocio   | Nombre y zona horaria del negocio (editable por OWNER y ADMIN).                                                                                                                    |
| `/appointments/[id]` | Sesión y negocio   | Historial del turno y explicación del riesgo con Gemini. Todavía no hay una agenda de turnos que enlace a esta página.                                                             |

Las rutas de `src/app/(app)` comparten el sidebar del dashboard (`AppSidebar`), con la cuenta, el acceso a Negocio y "Cerrar sesión". Sin sesión redirigen a `/login` y sin negocio a `/onboarding`. Si la API no puede resolver la cuenta, muestran el error con "Reintentar" y "Cerrar sesión" en lugar de quedar cargando.

Supabase se usa solo para autenticación; las operaciones de negocio pasan por la API (`src/lib/api.ts`), que agrega el token y normaliza los errores. Los colores y la tipografía salen de `src/app/theme.ts`.

## Stack

- Next.js 16, React 19 y TypeScript.
- Material UI, MUI Icons, Emotion y CSS Modules.
- Supabase JS, solo para Auth.
- `@turnosmart/shared`: contratos y validaciones compartidas con la API.
- Playwright para pruebas end-to-end.
- ESLint con las reglas de Next.js y React Compiler.

Previsto: calendario para la agenda semanal.

## Comandos

```bash
npm run dev:frontend
npm run build --workspace=@turnosmart/frontend
npm run typecheck --workspace=@turnosmart/frontend
npm run lint --workspace=@turnosmart/frontend
npm run test:e2e --workspace=@turnosmart/frontend
```

La app se sirve en `http://localhost:3000`. Next.js lee las variables desde `apps/frontend/.env.local` (plantilla: `apps/frontend/.env.example`), con los mismos valores de Supabase que `apps/backend/.env`. Sin las variables de Supabase solo funciona `/demo`. La guía completa para configurar y correr el proyecto está en el README de la raíz.

`test:e2e` corre el recorrido crítico sin mocks: requiere frontend, API y Supabase levantados, y una cuenta de prueba en `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`. Una cuenta nueva pasa por el onboarding una sola vez.

El despliegue en Vercel es manual, con el workflow **Frontend deploy (manual)**; los pasos están en el README de la raíz.

## Estructura

```text
apps/frontend/
├── e2e/                     # Pruebas end-to-end (Playwright)
├── src/
│   ├── app/
│   │   ├── (app)/           # Pantallas con sesión: agenda, clientes, negocio y detalle de turno
│   │   ├── demo/            # Dashboard con datos de ejemplo
│   │   ├── login/
│   │   ├── onboarding/
│   │   ├── page.module.css  # Estilos del dashboard
│   │   ├── providers.tsx    # Tema de MUI y sesión
│   │   └── theme.ts
│   ├── components/          # Sidebar, sesión, formularios, historial y panel de IA
│   └── lib/                 # Cliente HTTP, Supabase y zonas horarias
├── next.config.ts
├── playwright.config.ts
└── package.json
```

## Convenciones

- TypeScript en toda la lógica.
- Componentes pequeños y reutilizables; la lógica de datos en `src/lib`.
- Validaciones desde `@turnosmart/shared`, las mismas que usa la API.
- Estilos con el tema de MUI y CSS Modules, siguiendo el diseño del dashboard.
- La `service_role` de Supabase y la clave de Gemini nunca se usan en el frontend.

## Próximos pasos

- Agenda real con turnos del día y enlace al detalle de cada turno.
- Servicios y disponibilidad.
- Reserva, reprogramación y cancelación de turnos.
- Registro público y recuperación de contraseña.

## Contribución

1. Crear una rama desde la rama principal.
2. Desarrollar la funcionalidad con commits claros.
3. Validar que la app compila y no presenta errores de lint.
4. Abrir un pull request describiendo el cambio.

## Recursos útiles

- [Documentación de Next.js](https://nextjs.org/docs)
- [Next.js App Router](https://nextjs.org/docs/app)
- [TypeScript](https://www.typescriptlang.org/)
