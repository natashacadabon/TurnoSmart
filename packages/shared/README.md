# Shared

Paquete inicial para tipos y logica compartida.

Actualmente exporta `AppointmentStatus` y `RiskLevel`. Las constantes, validaciones y reglas del score todavia no estan implementadas.

Antes de consumir los estados en funcionalidades reales se debe alinear `PENDING` del paquete con `SCHEDULED` del enum de Prisma.

## Contenido planificado

- tipos de request y response;
- constantes de estados y riesgo;
- schemas de validacion reutilizables;
- reglas puras del score heuristico;
- utilidades sin dependencias de navegador o base de datos.
