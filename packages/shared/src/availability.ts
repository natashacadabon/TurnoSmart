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

const timeFormat = 'Ingresá una hora en formato HH:mm, entre 00:00 y 23:59.';
const localTime = z.string({ error: timeFormat }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, timeFormat);

const dayFormat = 'El día debe ser un entero de 0 (domingo) a 6 (sábado).';
export const availabilityRuleInputSchema = z
  .strictObject({
    dayOfWeek: z
      .number({ error: dayFormat })
      .int({ error: dayFormat })
      .min(0, { error: dayFormat })
      .max(6, { error: dayFormat }),
    startTime: localTime,
    endTime: localTime,
    active: z.boolean().default(true),
  })
  .refine((rule) => rule.startTime < rule.endTime, {
    path: ['endTime'],
    message: 'La hora de fin debe ser posterior a la de inicio en el mismo día.',
  });

export const replaceAvailabilityRulesSchema = z
  .strictObject({
    rules: z
      .array(availabilityRuleInputSchema, { error: 'Enviá la lista de franjas de la semana.' })
      .max(100, { error: 'La semana admite hasta 100 franjas.' }),
  })
  .superRefine(({ rules }, ctx) => {
    rules.forEach((rule, index) => {
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
            message: `Se solapa con la franja ${other.startTime}–${other.endTime} del mismo día. Revisá también las franjas inactivas.`,
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
