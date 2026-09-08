# Backend - TurnoSmart

API REST del sistema TurnoSmart, encargada de gestionar la lógica de negocio, la autenticación, la disponibilidad, los turnos y la integración con servicios externos.

## Descripción general

El backend será la capa central de la aplicación y tendrá como objetivo cubrir los procesos operativos del negocio, incluyendo:

- Autenticación y perfiles de usuarios
- Gestión de negocios, servicios y clientes
- Turnos, disponibilidad y eventos
- Cálculo de riesgo de no-show
- Recordatorios por email
- Integración con Gemini para recomendaciones inteligentes

## Stack previsto

Este stack representa la arquitectura planeada para el proyecto en fases iniciales y futuras:

- Node.js
- Express
- TypeScript
- Prisma ORM
- Zod
- Supabase PostgreSQL
- Supabase Auth
- Gemini API

> Algunos de estos elementos pueden estar pendientes de implementación inicial, pero se mantienen como referencia tecnológica del producto.

## Objetivos principales

- Exponer una API REST segura y escalable
- Centralizar la lógica de negocio
- Gestionar reservas, disponibilidad y clientes
- Mejorar la experiencia operativa con alertas y recomendaciones
- Integrar servicios externos para autenticación, base de datos y IA

## Requisitos previos

Antes de iniciar el proyecto asegúrate de tener instalado:

- Node.js 20+
- npm
- PostgreSQL o acceso a Supabase
- Credenciales de Supabase y Gemini si se activan las integraciones

## Instalación

```bash
cd apps/backend
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

- `npm run dev`: inicia el servidor en modo desarrollo
- `npm run build`: compila la aplicación para producción
- `npm run start`: ejecuta la versión compilada
- `npm run lint`: valida el código con análisis estático

## Ejecutar en local

```bash
cd apps/backend
npm run dev
```

## Estructura sugerida

```text
apps/backend/
├── src/
│   ├── app/              # Configuración y bootstrap
│   ├── config/           # Variables de entorno y configuración
│   ├── controllers/      # Controladores HTTP
│   ├── routes/           # Rutas de la API
│   ├── services/         # Lógica de negocio
│   ├── modules/          # Módulos funcionales
│   ├── middleware/       # Middleware de autenticación y validación
│   ├── utils/            # Helpers y utilidades
│   ├── validators/       # Validaciones con Zod
│   └── types/            # Tipos compartidos
├── prisma/               # Esquema y migraciones de Prisma
├── .env.example          # Variables de entorno de ejemplo
├── package.json
├── tsconfig.json
├── README.md
└── .gitignore
```

## Convenciones esperadas

- Usar TypeScript en toda la API
- Validar entradas con Zod
- Mantener separación entre rutas, controladores y servicios
- Centralizar configuración en variables de entorno
- Documentar endpoints y respuestas según evolucione la API
- Mantener la lógica de negocio limpia y reutilizable

## Estado del proyecto

El backend está en fase inicial de desarrollo. La base de la arquitectura y el stack previsto ya quedaron definidos, y se irá implementando la API con el enfoque de negocio de TurnoSmart.

## Roadmap sugerido

- Autenticación y perfiles
- CRUD de clientes, servicios y negocios
- Gestión de disponibilidad y horarios
- Reservas, reprogramaciones y cancelaciones
- Cálculo de riesgo de no-show
- Recordatorios automáticos
- Integración con IA para recomendaciones
- Mejoras de observabilidad y monitoreo

## Contribución

1. Crear una rama para la funcionalidad o corrección.
2. Desarrollar el cambio con commits claros.
3. Validar compilación y lint.
4. Abrir un pull request con una descripción del cambio.

## Recursos útiles

- [Node.js](https://nodejs.org/)
- [Express](https://expressjs.com/)
- [TypeScript](https://www.typescriptlang.org/)
- [Prisma](https://www.prisma.io/)
- [Supabase](https://supabase.com/)
- [Gemini API](https://ai.google.dev/)
