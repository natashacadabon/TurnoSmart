# Backend - TurnoSmart

API REST del sistema TurnoSmart, encargada de gestionar la lógica de negocio, la autenticación, la disponibilidad, los turnos y la integración con servicios externos.
Backend construido con Node.js, Express y TypeScript.

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

## Estado actual

Implementado:

- servidor Express y endpoint `GET /health`;
- Prisma Client;
- esquema PostgreSQL multi-tenant;
- migraciones y RLS para Supabase;
- seed idempotente de datos demo.

Pendiente:

- rutas y controladores de negocio;
- autenticacion y autorizacion;
- validacion de entradas;
- riesgo de no-show, Gemini, email y observabilidad.

Las carpetas de modulos y servicios son estructura preparada; no representan una API funcional completa.

## Variables

El backend carga `apps/backend/.env`. Consultar `.env.example` en la raiz. `DATABASE_URL` se usa en runtime y `DIRECT_URL` en migraciones. La service role de Supabase es exclusiva del backend y nunca debe enviarse al navegador.

## Comandos

```bash
npm run dev:backend
npm run build --workspace=@turnosmart/backend
npm run typecheck --workspace=@turnosmart/backend
npm run prisma:validate --workspace=@turnosmart/backend
npm run prisma:generate --workspace=@turnosmart/backend
npm run prisma:migrate --workspace=@turnosmart/backend
npm run prisma:seed --workspace=@turnosmart/backend
npm run prisma:studio --workspace=@turnosmart/backend
```

`prisma:migrate` aplica migraciones existentes mediante `prisma migrate deploy`.

## Modelo y seguridad

- `20260922000100_init_turnosmart`: tablas, enums, relaciones, indices y constraints.
- `20260922000200_enable_rls`: permisos y politicas RLS.

`Profile.id` debe coincidir con `auth.users.id`. El onboarding todavia no esta implementado y debera ejecutarse desde un backend confiable.

El health check actual confirma el proceso HTTP, no la conectividad con la base o servicios externos.

## Arquitectura planificada

La API se organizara por modulos de autenticacion, negocios, servicios, clientes, disponibilidad, turnos, eventos, riesgo, recordatorios y reportes. Las entradas se validaran con Zod; las rutas delegaran en servicios de dominio y Prisma concentrara el acceso a datos. Toda operacion autenticada debera resolver y filtrar el `businessId`.

## Integraciones planificadas

- Supabase Auth para sesiones y asociacion con `Profile.id`.
- Gemini para explicar factores calculados por reglas auditables.
- Proveedor de email para recordatorios y trazabilidad.
- Azure App Service para desplegar la API.
- Application Insights o Azure Monitor para logs y metricas.

Gemini no reemplazara el score heuristico ni tomara decisiones operativas por si solo.

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
