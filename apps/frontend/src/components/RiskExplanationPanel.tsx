'use client';

import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import type { RiskExplanationResponse, RiskLevel } from '@turnosmart/shared';
import { useState } from 'react';
import { ApiError, api, errorMessage } from '@/lib/api';
import { EmptyState } from './ui';

const LEVEL: Record<RiskLevel, { label: string; color: 'success' | 'warning' | 'error' }> = {
  LOW: { label: 'Riesgo bajo', color: 'success' },
  MEDIUM: { label: 'Riesgo medio', color: 'warning' },
  HIGH: { label: 'Riesgo alto', color: 'error' },
};

/** Medidor circular del score 0-100. */
function ScoreGauge({ score, level }: { score: number; level: RiskLevel }) {
  const color = `${LEVEL[level].color}.main`;
  return (
    <Box sx={{ position: 'relative', width: 112, height: 112, flexShrink: 0 }}>
      <CircularProgress
        variant="determinate"
        value={100}
        size={112}
        thickness={4}
        sx={{ color: 'action.hover', position: 'absolute' }}
      />
      <CircularProgress
        variant="determinate"
        value={score}
        size={112}
        thickness={4}
        aria-label={`Score ${score} de 100`}
        sx={{
          color,
          position: 'absolute',
          '& .MuiCircularProgress-circle': { strokeLinecap: 'round' },
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
        }}
      >
        <div>
          <Typography sx={{ fontSize: 32, fontWeight: 750, lineHeight: 1 }}>{score}</Typography>
          <Typography variant="caption" color="text.secondary">
            de 100
          </Typography>
        </div>
      </Box>
    </Box>
  );
}

/**
 * Explicación del score bajo demanda (A08). La llamada a Gemini sólo se hace al pulsar el botón;
 * si falla, el resto de la pantalla y la agenda siguen funcionando.
 */
export function RiskExplanationPanel({ appointmentId }: { appointmentId: string }) {
  const [result, setResult] = useState<RiskExplanationResponse | null>(null);
  const [error, setError] = useState<{ text: string; severity: 'error' | 'info' } | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestExplanation() {
    setLoading(true);
    setError(null);
    try {
      setResult(
        await api<RiskExplanationResponse>(`/api/appointments/${appointmentId}/risk/explanation`, {
          method: 'POST',
        }),
      );
    } catch (err) {
      const info = err instanceof ApiError && err.code === 'RISK_NOT_AVAILABLE';
      setError({ text: errorMessage(err), severity: info ? 'info' : 'error' });
    } finally {
      setLoading(false);
    }
  }

  const button = (
    <Button
      variant={result ? 'outlined' : 'contained'}
      startIcon={
        loading ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeRoundedIcon />
      }
      onClick={requestExplanation}
      disabled={loading}
    >
      {loading ? 'Consultando IA…' : result ? 'Volver a explicar' : 'Explicar con IA'}
    </Button>
  );

  return (
    <Card>
      <CardContent>
        <Stack
          direction="row"
          sx={{
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1,
            mb: 2,
          }}
        >
          <div>
            <Typography variant="h2">Riesgo de ausencia</Typography>
            <Typography variant="body2" color="text.secondary">
              Score heurístico calculado con el historial del turno.
            </Typography>
          </div>
          {result && button}
        </Stack>

        {error && (
          <Alert severity={error.severity} sx={{ mb: 2 }}>
            {error.text}
          </Alert>
        )}

        {!result && !loading && (
          <EmptyState
            icon={<InsightsRoundedIcon />}
            title="¿Qué tan probable es que el cliente venga?"
            description="Pedí una explicación para ver el score, los factores que lo componen y recomendaciones concretas."
            action={button}
          />
        )}

        {loading && !result && (
          <Stack direction="row" spacing={3} sx={{ alignItems: 'center', py: 2 }}>
            <Skeleton variant="circular" width={112} height={112} />
            <Box sx={{ flexGrow: 1 }}>
              <Skeleton width="40%" height={32} />
              <Skeleton width="90%" />
              <Skeleton width="75%" />
            </Box>
          </Stack>
        )}

        {result && (
          <Stack spacing={3} sx={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={3}
              sx={{ alignItems: { sm: 'center' } }}
            >
              <ScoreGauge score={result.risk.score} level={result.risk.level} />
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Chip
                  color={LEVEL[result.risk.level].color}
                  label={LEVEL[result.risk.level].label}
                  sx={{ mb: 1.5 }}
                />
                {result.risk.factors.length > 0 && (
                  <Stack
                    component="ul"
                    spacing={1}
                    sx={{ m: 0, p: 0, listStyle: 'none' }}
                    aria-label="Factores del score"
                  >
                    {result.risk.factors.map((f) => (
                      <Stack
                        component="li"
                        key={f.code}
                        direction="row"
                        spacing={1.5}
                        sx={{ alignItems: 'center' }}
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            minWidth: 44,
                            textAlign: 'center',
                            fontWeight: 700,
                            borderRadius: 1.5,
                            py: 0.25,
                            color: f.impact > 0 ? 'error.main' : 'success.main',
                            bgcolor: 'action.hover',
                          }}
                        >
                          {f.impact > 0 ? '+' : ''}
                          {f.impact}
                        </Typography>
                        <Typography variant="body2">{f.label}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Box>
            </Stack>

            <Divider />

            <Box>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', mb: 1.5, color: 'primary.main' }}
              >
                <AutoAwesomeRoundedIcon fontSize="small" />
                <Typography variant="subtitle2">Explicación</Typography>
              </Stack>
              <Typography sx={{ mb: 2, lineHeight: 1.7 }}>{result.explanation.summary}</Typography>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Recomendaciones
              </Typography>
              <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }}>
                {result.explanation.recommendations.map((r) => (
                  <Stack
                    component="li"
                    key={r}
                    direction="row"
                    spacing={1.25}
                    sx={{ alignItems: 'flex-start' }}
                  >
                    <CheckCircleRoundedIcon
                      fontSize="small"
                      sx={{ color: 'primary.main', mt: '2px' }}
                    />
                    <Typography>{r}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>

            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', pt: 1.5, borderTop: 1, borderColor: 'divider' }}
            >
              {result.disclaimer} Modelo: {result.model}.
            </Typography>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
