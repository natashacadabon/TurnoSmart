# Arquitectura

TurnoSmart se organiza como un monorepo con frontend, backend y codigo compartido.

```text
apps/
  frontend/   Next.js + TypeScript
  backend/    Node.js + Express + TypeScript

packages/
  shared/     Tipos, constantes y logica compartida

docs/
  Documentacion tecnica y funcional

infra/
  Docker, despliegue y configuracion cloud
```

## Flujo principal

```text
Cliente final / Personal administrativo
        |
        v
Frontend Next.js
        |
        | REST API
        v
Backend Express
        |
        |-- Supabase PostgreSQL
        |-- Supabase Auth
        |-- Gemini API
        |-- Proveedor de email
```

## Modulos

- Autenticacion y perfiles.
- Negocios.
- Servicios.
- Clientes.
- Disponibilidad.
- Turnos.
- Eventos de turno.
- Riesgo de no-show.
- Recordatorios.
- Reportes.

