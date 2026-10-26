export type LlmErrorKind = 'timeout' | 'quota' | 'unavailable';

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmRequest {
  systemInstruction: string;
  prompt: string;
  /** JSON Schema que debe respetar la respuesta. */
  responseJsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
  signal: AbortSignal;
}

/** Puerto hacia el proveedor de IA. Devuelve el texto crudo; la validación es del llamador. */
export interface LlmClient {
  readonly model: string;
  generateJson(request: LlmRequest): Promise<string>;
}
