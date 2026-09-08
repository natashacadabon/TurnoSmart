# TurnoSmart

TurnoSmart es una plataforma SaaS para la gestion inteligente de turnos en pequenos y medianos negocios. Combina una agenda online con analisis de riesgo de no-show para ayudar a reducir ausencias sin aviso, cancelaciones tardias y huecos dificiles de cubrir.

El proyecto fue pensado para negocios con atencion por reserva, como peluquerias, centros de estetica, consultorios, estudios y servicios profesionales.

## Problema

Los negocios que trabajan con turnos pierden tiempo e ingresos cuando los clientes no asisten, cancelan tarde o dejan espacios libres en la agenda. Las agendas tradicionales permiten registrar reservas, pero no aprovechan el historial de clientes para anticipar riesgos ni ayudar a tomar mejores decisiones operativas.

## Propuesta de valor

TurnoSmart permite administrar turnos, clientes, servicios y recordatorios desde un unico lugar. Su diferencial es un score de riesgo de no-show por turno, calculado a partir de reglas explicables y complementado con recomendaciones generadas por IA.

Con esta informacion, el negocio puede:

- identificar turnos con mayor probabilidad de ausencia;
- reforzar recordatorios para clientes de riesgo;
- priorizar confirmaciones antes de horarios criticos;
- mejorar la ocupacion de la agenda;
- reducir capacidad ociosa.

## Usuarios objetivo

- Negocios con atencion por turnos.
- Personal administrativo que organiza agenda, clientes, servicios y recordatorios.
- Clientes finales que necesitan reservar, cancelar o reprogramar de forma simple.

## Funcionalidades principales

### MVP

- Autenticacion de usuarios.
- Alta y configuracion de negocio.
- Gestion de servicios.
- Gestion de clientes.
- Agenda diaria y semanal.
- Creacion, reprogramacion y cancelacion de turnos.
- Estados de turno: programado, confirmado, cancelado, completado y no-show.
- Calculo de riesgo de no-show.
- Visualizacion del riesgo en la agenda.
- Recordatorios por email.
- Historial basico de turnos y eventos.

### Evoluciones futuras

- Lista de espera para cubrir horarios liberados.
- Sugerencias automaticas de clientes para ocupar huecos.
- Recordatorios por WhatsApp.
- Pagos o senas para confirmar turnos.
- Dashboard avanzado de ocupacion, ausencias y cancelaciones.
- Configuracion personalizada de umbrales de riesgo.

## Stack tecnologico

El proyecto se organiza como monorepo para separar frontend, backend y codigo compartido sin perder una estructura simple para el TP.

### Frontend

- Next.js
- React
- TypeScript
- Material UI
- CSS Modules
- React Hook Form
- Zod
- TanStack Query
- FullCalendar

### Backend

- Node.js
- Express
- TypeScript
- Prisma ORM
- Zod
- API REST

### Base de datos y autenticacion

- PostgreSQL
- Supabase
- Supabase Auth

### Inteligencia artificial

- Gemini API

La IA se usa como soporte explicativo y operativo. El score inicial de riesgo se basa en heuristicas auditables, y Gemini se utiliza para generar explicaciones y recomendaciones claras para el usuario.

### Infraestructura

- Docker
- Docker Compose
- GitHub Actions
- Vercel para frontend
- Azure App Service para backend
- Azure Monitor / Application Insights para logs y monitoreo

## Estructura del proyecto

```text
TurnoSmart/
|-- apps/
|   |-- frontend/        Aplicacion web Next.js
|   `-- backend/         API REST Node.js + Express
|-- packages/
|   `-- shared/          Tipos y logica compartida
|-- docs/                Documentacion funcional y tecnica
|-- infra/               Docker, deploy y cloud
|-- tests/               Pruebas de integracion y end-to-end
|-- .env.example         Variables de entorno de referencia
|-- .gitignore
|-- package.json
`-- README.md
```

## Arquitectura general

```text
Frontend
Next.js + TypeScript + Material UI
        |
        | REST API
        v
Backend
Node.js + Express + TypeScript
        |
        |-- Supabase PostgreSQL
        |-- Supabase Auth
        |-- Gemini API
        |-- Email provider
```

El frontend se despliega de forma independiente en Vercel. El backend expone una API REST desplegable en Azure App Service. Supabase centraliza la base de datos PostgreSQL y la autenticacion.

## Modelo de datos inicial

Entidades principales:

- `businesses`: negocios registrados en la plataforma.
- `profiles`: usuarios asociados a un negocio.
- `services`: servicios ofrecidos por el negocio.
- `customers`: clientes finales.
- `availability_rules`: reglas de disponibilidad horaria.
- `appointments`: turnos agendados.
- `appointment_events`: historial de cambios de cada turno.
- `risk_scores`: resultado del analisis de riesgo de no-show.
- `reminders`: recordatorios enviados.

## Riesgo de no-show

El score de riesgo se calcula con una primera version heuristica basada en:

- historial de ausencias del cliente;
- cancelaciones tardias;
- anticipacion con la que se hizo la reserva;
- dia y horario del turno;
- primera visita del cliente;
- cantidad de reprogramaciones recientes.

Niveles previstos:

- Bajo: recordatorio estandar.
- Medio: recordatorio anticipado y confirmacion sugerida.
- Alto: recordatorio reforzado y preparacion de alternativa para cubrir el horario.

## Identidad visual

La identidad visual propuesta es SaaS profesional, moderna y limpia, apta para rubros como estetica, salud, consultoria y servicios profesionales.

| Uso | Color | Hex |
| --- | --- | --- |
| Primario | Indigo | `#4F46E5` |
| Primario hover | Indigo oscuro | `#4338CA` |
| Secundario / IA | Violeta | `#8B5CF6` |
| Exito / confirmado | Verde | `#22C55E` |
| Advertencia / riesgo medio | Ambar | `#F59E0B` |
| Error / riesgo alto | Rojo | `#EF4444` |
| Fondo | Gris muy claro | `#F8FAFC` |
| Cards | Blanco | `#FFFFFF` |
| Texto principal | Slate | `#0F172A` |
| Texto secundario | Slate gris | `#64748B` |
| Bordes | Gris | `#E2E8F0` |

## Plan de desarrollo

El piloto se planifica en 8 semanas.

### Sprint 0

Setup tecnico, repositorio, CI basico, entornos, Supabase, arquitectura, diseno de datos y convenciones.

### Sprint 1

Autenticacion, onboarding de negocio, layout principal, perfiles y configuracion inicial.

### Sprint 2

CRUD de servicios, clientes y reglas de disponibilidad.

### Sprint 3

Agenda visual, creacion, reprogramacion, cancelacion de turnos y registro de eventos.

### Sprint 4

Calculo de riesgo de no-show, persistencia del score y visualizacion clara en la agenda.

### Sprint 5

Recordatorios por email segun riesgo, plantillas basicas y trazabilidad de envios.

### Sprint 6

Integracion con Gemini para explicacion del riesgo y recomendaciones de accion.

### Sprint 7

Pulido de UX, manejo de errores, metricas piloto, pruebas end-to-end, documentacion y despliegue.

## Testing

- Tests unitarios para calculo de riesgo, validaciones de turnos y reglas de estado.
- Tests de integracion para endpoints principales de la API.
- Tests end-to-end para flujos criticos: registro, creacion de servicio, alta de cliente, reserva de turno, cancelacion, envio de recordatorio y visualizacion de riesgo.
- Pruebas manuales con escenarios de peluqueria, consultorio y servicio profesional.

## Criterios de aceptacion del piloto

- Un negocio puede operar una agenda real de punta a punta.
- El personal puede crear servicios, clientes y turnos.
- Cada turno muestra un nivel de riesgo de no-show.
- Los turnos de riesgo medio o alto tienen recomendaciones accionables.
- El sistema permite enviar recordatorios por email.
- El frontend y el backend pueden desplegarse de forma independiente.

## Estado del proyecto

Proyecto en etapa de planificacion y preparacion tecnica para el desarrollo del piloto.
