import { z } from 'zod';

/** Regla semanal de lectura; las horas corresponden a la zona IANA del negocio. */
export interface AvailabilityRuleDto {
  id: string;
  /** Dia de la semana: 0 domingo, 6 sabado. Requiere validacion en ejecucion. */
  dayOfWeek: number;
  /** Hora local HH:mm, sin fecha, offset ni conversion a UTC. */
  startTime: string;
  /** Hora local HH:mm, sin fecha, offset ni conversion a UTC. */
  endTime: string;
  active: boolean;
  /** Instante UTC ISO 8601 con milisegundos y sufijo Z. */
  createdAt: string;
  /** Instante UTC ISO 8601 con milisegundos y sufijo Z. */
  updatedAt: string;
}

const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Debe usar HH:mm (00:00..23:59)');

export const replaceAvailabilityRulesSchema = z
  .strictObject({
    rules: z
      .array(
        z.strictObject({
          dayOfWeek: z.number().int().min(0).max(6),
          startTime: localTime,
          endTime: localTime,
          active: z.boolean().default(true),
        }),
      )
      .max(100),
  })
  .superRefine(({ rules }, ctx) => {
    rules.forEach((rule, index) => {
      if (rule.startTime >= rule.endTime) {
        ctx.addIssue({
          code: 'custom',
          path: ['rules', index, 'endTime'],
          message: 'Debe ser posterior a startTime dentro del mismo dia',
        });
      }
      for (let previous = 0; previous < index; previous++) {
        const other = rules[previous]!;
        if (
          rule.dayOfWeek === other.dayOfWeek &&
          rule.startTime < other.endTime &&
          other.startTime < rule.endTime
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['rules', index, 'startTime'],
            message: 'Las franjas del mismo dia no pueden solaparse, incluso inactivas',
          });
          break;
        }
      }
    });
  });

export type ReplaceAvailabilityRulesRequest = z.input<typeof replaceAvailabilityRulesSchema>;
export type AvailabilityRuleInput = z.output<
  typeof replaceAvailabilityRulesSchema
>['rules'][number];

export interface AvailabilityRulesResponse {
  data: { timezone: string; rules: AvailabilityRuleDto[] };
}
