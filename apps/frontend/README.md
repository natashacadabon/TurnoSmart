# Frontend - TurnoSmart

Aplicación web del cliente para la gestión operativa de TurnoSmart. Esta interfaz permite visualizar la agenda, gestionar reservas y colaborar con la operación diaria del negocio.

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

## Requisitos previos

Antes de iniciar el proyecto asegúrate de tener instalado:

- Node.js 20+
- npm, pnpm, yarn o bun

## Instalación

Desde la raíz del proyecto o dentro de la carpeta del frontend:

```bash
cd apps/frontend
npm install
```

## Scripts disponibles

```bash
npm run dev
npm run build
npm run start
npm run lint
```

### Comandos principales

- `npm run dev`: inicia el servidor de desarrollo.
- `npm run build`: compila la aplicación para producción.
- `npm run start`: levanta la versión compilada.
- `npm run lint`: ejecuta el análisis estático del código.

## Ejecutar en local

```bash
cd apps/frontend
npm run dev
```

Luego abre tu navegador en:

```text
http://localhost:3000
```

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

