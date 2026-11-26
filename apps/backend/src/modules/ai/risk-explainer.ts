import { riskExplanationSchema, type RiskExplanation, type RiskScoreDto } from '@turnosmart/shared';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { LlmError, type LlmClient } from './llm.js';

const SYSTEM_INSTRUCTION = [
  'Sos un asistente para comercios que gestionan turnos.',
  'Recibís un score heurístico de riesgo de ausencia (0-100) y los factores que lo componen.',
  'Explicá por qué el score es ese y qué acciones concretas puede tomar el comercio.',
  'Escribí en español claro y profesional, con tono cordial y respetuoso, como un informe breve para el dueño del negocio.',
  'Podés usar voseo, pero nunca lunfardo, insultos, malas palabras ni expresiones vulgares o despectivas sobre el cliente.',
  'Referite a la persona como "el cliente", sin juzgarla. Escribí los números con cifras.',
  'No inventes datos que no estén en los factores. No presentes el score como una probabilidad calibrada.',
  'No decidas ni sugieras cancelar automáticamente el turno.',
].join(' ');

const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Explicación breve, máximo 3 oraciones.' },
    recommendations: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 4,
      description: 'Acciones concretas y no automáticas para el comercio.',
    },
  },
  required: ['summary', 'recommendations'],
};

export const DISCLAIMER =
  'Score heurístico basado en reglas simples; no es una probabilidad validada. La explicación es generada por IA y no modifica el turno.';

/** Sólo factores agregados: el prompt nunca incluye datos identificatorios. */
export function buildPrompt(risk: Pick<RiskScoreDto, 'score' | 'level' | 'factors'>): string {
  return JSON.stringify({
    score: risk.score,
    level: risk.level,
    factors: risk.factors.map((f) => ({
      code: f.code,
      label: f.label,
      impact: f.impact,
      value: f.value ?? null,
    })),
  });
}

export interface RiskExplainerOptions {
  timeoutMs: number;
  maxOutputTokens: number;
}

export class RiskExplainer {
  constructor(
    private readonly llm: LlmClient,
    private readonly options: RiskExplainerOptions,
  ) {}

  get model(): string {
    return this.llm.model;
  }

  /**
   * Una llamada + como máximo un reintento, sólo si la respuesta no respetó el formato.
   * Timeout y cuota no se reintentan para no convertir una falla en consumo extra.
   */
  async explain(risk: RiskScoreDto, requestId?: string): Promise<RiskExplanation> {
    const prompt = buildPrompt(risk);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const raw = await this.call(prompt);
      const parsed = parseExplanation(raw);
      if (parsed) return parsed;
      logger.warn('ai_invalid_response', { requestId, attempt, model: this.llm.model });
    }
    throw new AppError('AI_INVALID_RESPONSE', 'La IA devolvió una respuesta inválida');
  }

  private async call(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      return await Promise.race([
        this.llm.generateJson({
          systemInstruction: SYSTEM_INSTRUCTION,
          prompt,
          responseJsonSchema: RESPONSE_JSON_SCHEMA,
          maxOutputTokens: this.options.maxOutputTokens,
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener('abort', () =>
            reject(new LlmError('timeout', 'Gemini no respondió a tiempo')),
          ),
        ),
      ]);
    } catch (err) {
      if (err instanceof LlmError) {
        if (err.kind === 'timeout') throw new AppError('AI_TIMEOUT', 'La IA no respondió a tiempo');
        if (err.kind === 'quota')
          throw new AppError('AI_RATE_LIMITED', 'Cuota de IA agotada, intente más tarde');
      }
      throw new AppError('AI_UNAVAILABLE', 'Servicio de IA no disponible');
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseExplanation(raw: string): RiskExplanation | null {
  try {
    const result = riskExplanationSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
