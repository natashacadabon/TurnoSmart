# Backlog del Desarrollador A — 56 h

Registro histórico del 26 de octubre de 2026. Desde ese corte se integraron el score real, el historial desde la agenda, los flujos de Vercel y escenarios Playwright de turnos. El trabajo vigente y las verificaciones pendientes están en el [backlog general](backlog.md).

| ID  | Tarea                                                              | h   | Estado              | Dónde                                                           | Falta para aceptar                                                   |
| --- | ------------------------------------------------------------------ | --- | ------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| A01 | Contratos comunes: identidad, errores, consumo de shared           | 3   | Implementado        | `packages/shared`, `docs/contracts.md`                          | Revisión de B y C                                                    |
| A02 | App Express testeable, entorno, CORS, errores uniformes            | 5   | Implementado        | `apps/backend/src/app.ts`, `index.ts`, `config/`, `middleware/` | —                                                                    |
| A03 | Login/logout y contexto autenticado en API                         | 7   | Verificado en local | `middleware/auth.ts`, `AuthProvider.tsx`, `/login`              | —                                                                    |
| A04 | Invitación de OWNER + configuración del negocio                    | 6   | Verificado en local | `modules/identity`, `modules/admin`, `/onboarding`, `/settings` | —                                                                    |
| A05 | Clientes: endpoints, búsqueda, listado, formularios                | 6   | Verificado en local | `modules/customers`, `/customers`, `CustomerFormDialog.tsx`     | —                                                                    |
| A06 | Integración de Auth, permisos y acceso entre tenants               | 4   | Verificado en local | `apps/backend/test`                                             | Correr `test:integration` en CI con Supabase local (B02)             |
| A07 | Frontend con deploy manual (Vercel Hobby o Azure)                  | 6   | Preparado           | `.github/workflows/frontend-deploy.yml`                         | Decidir destino con B; Azure requiere `output: 'standalone'`; V1     |
| A08 | Adaptador Gemini, endpoint y panel de explicación                  | 6   | Implementado        | `modules/ai`, `RiskExplanationPanel.tsx`                        | Score real de C (C08), llamada real en este repo, prueba en V2       |
| A09 | E2E del recorrido crítico y recuperación ante error                | 4   | Verificado en local | `apps/frontend/e2e`                                             | Sumar reservar, reprogramar y cancelar cuando estén B03–B05/C03–C06  |
| A10 | Arquitectura, AI-DECISIONS, matriz de requisitos, consulta docente | 3   | En curso            | `docs/architecture.md`, `AI-DECISIONS.md`                       | Enviar la consulta docente y registrar la respuesta                  |
| A11 | Créditos, cuotas, presupuesto y ledger de costos                   | 3   | En curso            | `docs/costs.md`                                                 | Crear budget USD 2, decisión de Vercel, completar ledger por ventana |
| C07 | Historial de eventos (lectura + UI)                                | 3   | Implementado        | `modules/events`, `EventHistory.tsx`                            | Eventos reales escritos por C; enlace desde la agenda (C)            |

## Integraciones previstas en el corte de octubre

- **C**: persistir `RiskScore.factors` como `RiskFactor[]` (`{code, label, impact, value?}`). Si se quiere mostrar estado
  anterior/nuevo o actor en el historial, guardarlos en `AppointmentEvent.metadata`.
- **B**: B02 agrega Supabase local a CI para `test:integration`; B10 restringe escrituras directas vía la API de datos.
- **B (A07/A11)**: destino del frontend (Vercel Hobby o Azure).
