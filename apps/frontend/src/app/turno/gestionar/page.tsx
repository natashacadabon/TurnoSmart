import type { Metadata } from 'next';
import { PublicAppointmentAction } from '@/components/appointments/PublicAppointmentAction';

export const metadata: Metadata = {
  title: 'Gestionar turno | TurnoSmart',
  referrer: 'no-referrer',
};

export default function Page() {
  return <PublicAppointmentAction />;
}
