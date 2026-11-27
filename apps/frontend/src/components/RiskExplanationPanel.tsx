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
import { useEffect, useId, useState } from 'react';
import { ApiError, api, errorMessage } from '@/lib/api';
import { EmptyState } from './ui';

const LEVEL: Record<RiskLevel, { label: string; color: 'success' | 'warning' | 'error' }> = {
  LOW: { label: 'Riesgo bajo', color: 'success' },
  MEDIUM: { label: 'Riesgo medio', color: 'warning' },
  HIGH: { label: 'Riesgo alto', color: 'error' },
};

/** Medidor circular del score 0-100. */
function ScoreGauge({
  score,
  level,
  compact,
}: {
  score: number;
  level: RiskLevel;
  compact: boolean;
}) {
  const color = `${LEVEL[level].color}.main`;
  const size = compact ? 88 : 112;
  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <CircularProgress
        variant="determinate"
        value={100}
        size={size}
        thickness={4}
        aria-hidden
        sx={{ color: 'action.hover', position: 'absolute' }}
      />
      <CircularProgress
        variant="determinate"
        value={score}
        size={size}
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
          <Typography sx={{ fontSize: compact ? 26 : 32, fontWeight: 750, lineHeight: 1 }}>
            {score}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            de 100
          </Typography>
        </div>
      </Box>
    </Box>
  );
}

type PanelError = { text: string; severity: 'error' | 'info' };

/** Pide la explicación. Sin refresh, el servidor reutiliza la de la versión actual del score. */
function fetchExplanation(appointmentId: string, refresh: boolean) {
  return api<RiskExplanationResponse>(
    `/api/appointments/${appointmentId}/risk/explanation${refresh ? '?refresh=true' : ''}`,
    { method: 'POST' },
  );
}

function toPanelError(err: unknown): PanelError {
  // Sin score, IA no configurada o límite alcanzado no son fallas de la pantalla: se informan.
  const info =
    err instanceof ApiError &&
    ['RISK_NOT_AVAILABLE', 'AI_UNAVAILABLE', 'RATE_LIMITED', 'AI_RATE_LIMITED'].includes(err.code);
  return { text: errorMessage(err), severity: info ? 'info' : 'error' };
}

/**
 * Riesgo de ausencia con explicación de IA (A08). Con `autoLoad` se pide sola al abrir la pantalla:
 * el servidor guarda la explicación de cada versión del score, así que sólo llama a Gemini la
 * primera vez o cuando el score cambió (al confirmar o reprogramar el turno se vuelve a montar).
 * Si falla, el resto de la pantalla y la agenda siguen funcionando.
 */
export function RiskExplanationPanel({
  appointmentId,
  compact = false,
  autoLoad = false,
  initialResult,
  onExplained,
}: {
  appointmentId: string;
  compact?: boolean;
  autoLoad?: boolean;
  initialResult?: RiskExplanationResponse | undefined;
  onExplained?(result: RiskExplanationResponse): void;
}) {
  const [result, setResult] = useState<RiskExplanationResponse | null>(initialResult ?? null);
  const [error, setError] = useState<PanelError | null>(null);
  const [loading, setLoading] = useState(autoLoad && !initialResult);
  const heading = useId();

  useEffect(() => {
    if (!autoLoad || initialResult) return;
    let active = true;
    fetchExplanation(appointmentId, false).then(
      (explanation) => {
        if (!active) return;
        setResult(explanation);
        setLoading(false);
        onExplained?.(explanation);
      },
      (err: unknown) => {
        if (!active) return;
        setError(toPanelError(err));
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
    // Se pide una vez por montaje; el padre vuelve a montar el panel cuando cambia el turno.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function requestExplanation() {
    setLoading(true);
    setError(null);
    try {
      // Con una explicación a la vista, el botón pide una nueva; si no, reutiliza la guardada.
      const explanation = await fetchExplanation(appointmentId, result !== null);
      setResult(explanation);
      onExplained?.(explanation);
    } catch (err) {
      setError(toPanelError(err));
    } finally {
      setLoading(false);
    }
  }

  const button = (
    <Button
      size={compact ? 'small' : 'medium'}
      variant={result ? 'outlined' : 'contained'}
      startIcon={
        loading ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeRoundedIcon />
      }
      onClick={requestExplanation}
      disabled={loading}
    >
      {loading ? 'Consultando IA…' : result ? 'Generar de nuevo' : 'Explicar con IA'}
    </Button>
  );

  return (
    <Card component="section" aria-labelledby={heading}>
      <CardContent sx={compact ? { px: 2, py: 1.5, '&:last-child': { pb: 1.5 } } : undefined}>
        <Stack
          direction="row"
          sx={{
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1,
            mb: compact ? (result || error || loading ? 1.25 : 0) : 2,
          }}
        >
          <div>
            <Typography id={heading} variant="h2">
              Riesgo de ausencia
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {compact
                ? 'Score heurístico del turno.'
                : 'Score heurístico calculado con el historial del turno.'}
            </Typography>
          </div>
          {(result || compact) && button}
        </Stack>

        {error && (
          <Alert severity={error.severity} sx={{ mb: compact && !result ? 0 : 2 }}>
            {error.text}
          </Alert>
        )}

        {!result && !loading && !compact && !error && (
          <EmptyState
            icon={<InsightsRoundedIcon />}
            title="¿Qué tan probable es que el cliente venga?"
            description="Pedí una explicación para ver el score, los factores que lo componen y recomendaciones concretas."
            action={button}
          />
        )}

        {loading && !result && (
          <Stack
            direction="row"
            spacing={compact ? 1.5 : 3}
            sx={{ alignItems: 'center', py: compact ? 0 : 2 }}
          >
            <Skeleton variant="circular" width={compact ? 88 : 112} height={compact ? 88 : 112} />
            <Box sx={{ flexGrow: 1 }}>
              <Skeleton width="40%" height={32} />
              <Skeleton width="90%" />
              <Skeleton width="75%" />
            </Box>
          </Stack>
        )}

        {result && (
          <Stack
            spacing={compact ? 1.5 : 3}
            sx={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}
          >
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={compact ? 1.5 : 3}
              sx={{ alignItems: { sm: 'center' } }}
            >
              <ScoreGauge score={result.risk.score} level={result.risk.level} compact={compact} />
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
