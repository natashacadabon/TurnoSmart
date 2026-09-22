# Tests

No hay suites automatizadas implementadas actualmente.

Estrategia prevista:

- unit tests para riesgo, validaciones y estados;
- integration tests para API y Prisma;
- pruebas RLS con dos negocios;
- E2E para registro, clientes, servicios, turnos y recordatorios;
- pruebas manuales para distintos tipos de negocio.

Estas pruebas corresponden a etapas posteriores y no se presentan como funcionalidad existente.

## Cobertura planificada

### Unitarias

- calculo del riesgo, disponibilidad y estados;
- validaciones de entrada.

### Integracion

- endpoints, Prisma y base de prueba;
- aislamiento por `businessId` y politicas RLS.

### End-to-end

- registro y onboarding;
- servicios, clientes y reservas;
- confirmacion, cancelacion, riesgo y recordatorios.

El criterio del piloto sera operar una agenda completa e identificar turnos riesgosos sin intervencion tecnica.
