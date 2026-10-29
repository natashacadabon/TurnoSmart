# Backlog del Desarrollador A — 56 h

Estado en este repositorio al 26/10/2026. "Implementado" significa código + tests locales; la aceptación final requiere
además la validación cloud de las ventanas V1–V4.

| ID  | Tarea                                                              | h   | Estado              | Dónde                                                           | Falta para aceptar                                                   |
| --- | ------------------------------------------------------------------ | --- | ------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| A01 | Contratos comunes: identidad, errores, consumo de shared           | 3   | Implementado        | `packages/shared`, `docs/contracts.md`                          | Revisión de B y C                                                    |
| A02 | App Express testeable, entorno, CORS, errores uniformes            | 5   | Implementado        | `apps/backend/src/app.ts`, `index.ts`, `config/`, `middleware/` | —                                                                    |
| A03 | Login/logout y contexto autenticado en API                         | 7   | Verificado en local | `middleware/auth.ts`, `AuthProvider.tsx`, `/login`              | —                                                                    |
| A04 | Onboarding transaccional + configuración del negocio               | 6   | Verificado en local | `modules/identity`, `/onboarding`, `/settings`                  | —                                                                    |
| A05 | Clientes: endpoints, búsqueda, listado, formularios                | 6   | Verificado en local | `modules/customers`, `/customers`, `CustomerFormDialog.tsx`     | —                                                                    |
| A06 | Integración de Auth, permisos y acceso entre tenants               | 4   | Verificado en local | `apps/backend/test`                                             | Correr `test:integration` en CI con Supabase local (B02)             |
| A07 | Frontend con deploy manual (Vercel Hobby o Azure)                  | 6   | Preparado           | `.github/workflows/frontend-deploy.yml`                         | Decidir destino con B; Azure requiere `output: 'standalone'`; V1     |
| A08 | Adaptador Gemini, endpoint y panel de explicación                  | 6   | Implementado        | `modules/ai`, `RiskExplanationPanel.tsx`                        | Score real de C (C08), llamada real en este repo, prueba en V2       |
| A09 | E2E del recorrido crítico y recuperación ante error                | 4   | Verificado en local | `apps/frontend/e2e`                                             | Sumar reservar, reprogramar y cancelar cuando estén B03–B05/C03–C06  |
| A10 | Arquitectura, AI-DECISIONS, matriz de requisitos, consulta docente | 3   | En curso            | `docs/architecture.md`, `AI-DECISIONS.md`                       | Enviar la consulta docente y registrar la respuesta                  |
| A11 | Créditos, cuotas, presupuesto y ledger de costos                   | 3   | En curso            | `docs/costs.md`                                                 | Crear budget USD 2, decisión de Vercel, completar ledger por ventana |
| C07 | Historial de eventos (lectura + UI)                                | 3   | Implementado        | `modules/events`, `EventHistory.tsx`                            | Eventos reales escritos por C; enlace desde la agenda (C)            |

## Integraciones pendientes con el equipo

- **C**: persistir `RiskScore.factors` como `RiskFactor[]` (`{code, label, impact, value?}`). Si se quiere mostrar estado
  anterior/nuevo o actor en el historial, guardarlos en `AppointmentEvent.metadata`.
- **B**: B02 agrega Supabase local a CI para `test:integration`; B10 restringe escrituras directas vía la API de datos.
- **B (A07/A11)**: destino del frontend (Vercel Hobby o Azure).
