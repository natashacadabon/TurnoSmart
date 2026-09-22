# Frontend - TurnoSmart

Aplicación web del cliente para la gestión operativa de TurnoSmart. Esta interfaz permite visualizar la agenda, gestionar reservas y colaborar con la operación diaria del negocio.

Aplicacion construida con Next.js 16, React 19, TypeScript, Material UI y CSS Modules.

## Descripción general

El frontend está construido con Next.js y TypeScript, y está orientado a ofrecer una experiencia rápida y clara para:

- Dashboard operativo
- Agenda diaria y semanal
- Gestión de clientes y servicios
- Visualización del riesgo de no-show
- Reservas, reprogramaciones y cancelaciones
- Seguimiento del estado del negocio en tiempo real

## Stack tecnológico

- Next.js 16
- React 19
- TypeScript
- CSS Modules
- ESLint
- App Router de Next.js
- Material UI
- TanStack Query
- React Hook Form
- Zod
- FullCalendar

## Estado actual

Existe un dashboard demostrativo y responsive con navegacion, metricas, turnos priorizados, estados, riesgos y recomendaciones. Los datos son estaticos: no hay autenticacion, fetching de API, formularios CRUD ni calendario funcional.

## Dependencias implementadas

- Next.js y React;
- TypeScript;
- Material UI, MUI Icons y Emotion;
- CSS Modules y ESLint.

TanStack Query, React Hook Form, Zod y FullCalendar pertenecen al stack previsto, pero no estan instalados.

## Comandos

```bash
npm run dev:frontend
npm run build --workspace=@turnosmart/frontend
npm run typecheck --workspace=@turnosmart/frontend
npm run lint --workspace=@turnosmart/frontend
```

La app se sirve en `http://localhost:3000`. En Docker, `NEXT_PUBLIC_API_URL` apunta a `http://localhost:4000`; la integracion HTTP todavia no esta implementada.

Vercel es el destino previsto, pero no hay evidencia versionada de un despliegue activo.

## Funcionalidades planificadas

- login, logout y onboarding;
- agenda diaria y semanal;
- gestion de clientes y servicios;
- creacion, reprogramacion y cancelacion de turnos;
- filtros, historial y recordatorios;
- dashboard de ocupacion y no-shows;
- explicaciones de riesgo generadas por IA.

## Evolucion tecnica prevista

- React Hook Form y Zod para formularios;
- TanStack Query para consumir la API;
- FullCalendar para la agenda;
- cliente de Supabase con anon key para sesiones;
- pruebas de componentes y flujos criticos;
- despliegue independiente en Vercel.

La service role de Supabase nunca se utilizara en el frontend.

## Estructura principal

```text
apps/frontend/
├── public/              # Archivos estáticos
├── src/
│   ├── app/             # Rutas y layout principal de Next.js
│   ├── components/      # Componentes reutilizables
│   ├── features/        # Módulos funcionales del negocio
│   ├── lib/             # Utilidades y helpers
│   ├── styles/          # Estilos globales y temas
│   └── types/           # Tipos compartidos
├── eslint.config.mjs
├── next.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Convenciones

- Usar TypeScript para toda nueva lógica.
- Mantener componentes pequeños y reutilizables.
- Evitar lógica compleja dentro de páginas; preferir módulos y features.
- Seguir la estructura del App Router de Next.js.
- Mantener estilos consistentes con CSS Modules o estilos locales.

## Estado del proyecto

Este frontend está en fase inicial de desarrollo. La base del proyecto ya quedó configurada y está listo para comenzar a implementar las pantallas y flujos reales de negocio.

## Roadmap sugerido

- Dashboard principal
- Calendario de agenda
- Gestión de clientes
- Gestión de servicios
- Modales de reserva y cancelación
- Integración con backend y APIs
- Validación de formularios
- Mejoras de UX y accesibilidad

## Contribución

Para contribuir al proyecto:

1. Crear una rama desde la rama principal.
2. Desarrollar la funcionalidad con commits claros.
3. Validar que la app compila y no presenta errores de lint.
4. Abrir un pull request describiendo el cambio.

## Recursos útiles

- [Documentación de Next.js](https://nextjs.org/docs)
- [Next.js App Router](https://nextjs.org/docs/app)
- [TypeScript](https://www.typescriptlang.org/)
