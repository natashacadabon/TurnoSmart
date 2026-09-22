# Shared

Paquete inicial para tipos y logica compartida.

Actualmente exporta `AppointmentStatus` y `RiskLevel`. `AppointmentStatus` usa `SCHEDULED`, igual que el enum persistido por Prisma. Las constantes, validaciones y reglas del score todavia no estan implementadas.

## Contenido planificado

- tipos de request y response;
- constantes de estados y riesgo;
- schemas de validacion reutilizables;
- reglas puras del score heuristico;
- utilidades sin dependencias de navegador o base de datos.
