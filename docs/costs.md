# Créditos y costos (A11)

Objetivo: USD 0 de dinero personal. Lo que consume créditos se registra como costo aunque el desembolso sea cero.
Precios públicos consultados el 19/10/2026 (East US, USD, sin impuestos); no reemplazan las condiciones de la cuenta.

## Relevamiento de la cuenta

Relevado por A el 23/10/2026. Los IDs de suscripción y de cuenta de facturación se omiten a propósito.

| Dato                                        | Valor                                                                                                                                                                                     | Fuente / fecha                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Titular de la suscripción Azure             | Yael Pilar Luque (cuenta institucional, directorio UTN FRLP), rol Owner                                                                                                                   | Portal → Subscriptions → Overview, 23/10/2026                             |
| Offer ID                                    | No aplica: la suscripción es "Azure Plan" bajo Microsoft Customer Agreement (no usa el Offer ID heredado `MS-AZR-0170P`)                                                                  | Portal → Subscriptions → Overview / Cost Management + Billing, 23/10/2026 |
| Suscripción                                 | Azure for Students — estado Active, sin recursos creados                                                                                                                                  | Portal → Subscriptions → Overview, 23/10/2026                             |
| Moneda                                      | USD                                                                                                                                                                                       | Portal → Cost Management + Billing → Summary, 23/10/2026                  |
| Saldo utilizable                            | USD 98,79 de USD 100 (USD 1,21 consumidos); costo de octubre USD 0,00                                                                                                                     | Portal → Cost Management + Billing → Summary, 23/10/2026                  |
| Vencimiento del crédito                     | 10/04/2027 (170 días al 23/10/2026)                                                                                                                                                       | Portal → Education → Overview, 23/10/2026                                 |
| Servicios excluidos                         | No figura en el portal. La oferta pública excluye Marketplace: no usar imágenes ni servicios de Marketplace                                                                               | Oferta pública Azure for Students; pendiente de confirmar en la cuenta    |
| Región / SKU permitidos                     | Pendiente: validar East US + App Service F1/B1 con el what-if de B07 antes de V1                                                                                                          | —                                                                         |
| Spending limit activo                       | Sin medio de pago asociado (0 métodos de pago): el consumo no puede exceder el crédito                                                                                                    | Portal → Cost Management + Billing → Payment methods, 23/10/2026          |
| Facturación adicional habilitada            | No: sin medio de pago y "Amount due USD 0,00 — No payment needed"                                                                                                                         | Portal → Cost Management + Billing → Summary, 23/10/2026                  |
| Budget de la suscripción                    | Disponible (opción "Add" habilitada), todavía no creado                                                                                                                                   | Portal → Subscriptions → Budgets, 23/10/2026                              |
| Vercel Hobby elegible para este repo/equipo | Probablemente sí: repositorio público y proyecto académico no comercial. Proyecto `turnosmart` creado en Hobby, sin Git conectado (deploy sólo manual). Pendiente confirmar destino con B | vercel.com/docs/plans/hobby y dashboard de Vercel, 23/10/2026             |
| Supabase de demo                            | Proyecto `turnosmart-demo`, plan Free, región East US (North Virginia), misma zona que Azure East US. Se pausa tras una semana sin uso: restaurar antes de cada ventana                   | Dashboard de Supabase, 23/10/2026                                         |
| Gemini: modelo habilitado y cuota Free      | `gemini-3.5-flash-lite` responde con clave Free, sin facturación activada                                                                                                                 | Llamada real desde la app local, 21/10/2026                               |
| GitHub Actions: minutos disponibles         | Sin límite en runners Linux estándar (repositorio público). Cuidar el almacenamiento de artefactos (500 MB)                                                                               | Visibilidad del repositorio en GitHub, 23/10/2026                         |

No sumar beneficios de los tres integrantes ni asumir créditos de Vercel, Supabase o Google.

## Presupuesto interno

- Techo propuesto: **USD 2 brutos** en Azure para el checkpoint (sujeto a saldo y aprobación del equipo).
- Alertas al 25 %, 50 %, 80 % y 100 %. Los budgets avisan, no detienen recursos.
- Gemini: sólo Free; un fallo de cuota nunca pasa a uso pago silenciosamente.

## Estimación por ventana

| Ventana   | Fecha | Horas máx. | B1 bruto (si se usa) | Escenario base |
| --------- | ----- | ---------- | -------------------- | -------------- |
| V1        | 29/10 | 4          | USD 0,068            | USD 0          |
| V2        | 03/11 | 4          | USD 0,068            | USD 0          |
| V3        | 06/11 | 2          | USD 0,034            | USD 0          |
| V4        | 09/11 | 4          | USD 0,068            | USD 0          |
| **Total** |       | **14**     | **USD 0,238**        | **USD 0**      |

Sensibilidad si se agotan franquicias: logs USD 0,184 + Actions USD 0,720 + IA paid hipotética USD 0,104 → hasta ~USD 1,25.

## Ledger por ventana (completar después de cada cierre)

| Ventana | Operador / verificador | Inicio–fin real | Recursos creados | SKU | Costo estimado | Costo real (proveedor) | Inventario vacío verificado | Notas |
| ------- | ---------------------- | --------------- | ---------------- | --- | -------------- | ---------------------- | --------------------------- | ----- |
| V1      | B / A                  |                 |                  |     |                |                        |                             |       |
| V2      | C / B                  |                 |                  |     |                |                        |                             |       |
| V3      | A / C                  |                 |                  |     |                |                        |                             |       |
| V4      | B / A                  |                 |                  |     |                |                        |                             |       |

El costo real puede aparecer al día siguiente: reconciliar cuando el proveedor lo publique.
