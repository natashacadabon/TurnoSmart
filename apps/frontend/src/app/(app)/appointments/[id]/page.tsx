'use client';

import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { Box, Button } from '@mui/material';
import Link from 'next/link';
import { use } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { EventHistory } from '@/components/EventHistory';
import { RiskExplanationPanel } from '@/components/RiskExplanationPanel';
import { PageHeader } from '@/components/ui';

/**
 * Detalle del turno: A aporta explicación de riesgo e historial.
 * C integra aquí los datos del turno, el score y las acciones de estado (C02/C06/C08).
 */
export default function AppointmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useAuth();
  if (!me?.onboarded) return null;

  return (
    <>
      <PageHeader
        title="Detalle del turno"
        subtitle="Riesgo de ausencia y movimientos registrados."
        back={
          <Button
            component={Link}
            href="/customers"
            size="small"
            startIcon={<ArrowBackRoundedIcon />}
            sx={{ ml: -1, mb: 1, color: 'text.secondary' }}
          >
            Volver
          </Button>
        }
      />
      <Box
        sx={{
          display: 'grid',
          gap: 2.5,
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 2fr) minmax(320px, 1fr)' },
          alignItems: 'start',
        }}
      >
        <RiskExplanationPanel appointmentId={id} />
        <EventHistory appointmentId={id} timezone={me.business.timezone} />
      </Box>
    </>
  );
}
