import type { PrismaClient } from '@prisma/client';

/** Preflight de solo lectura. No aplica migraciones ni consulta datos de usuarios. */
export async function checkSeedSchema(prisma: PrismaClient) {
  await prisma.$queryRaw`
    SELECT 1 FROM public.businesses, public.profiles, public.customers,
      public.services, public.availability_rules, public.appointments,
      public.appointment_events, public.risk_scores, public.reminders
    LIMIT 0
  `;
}
