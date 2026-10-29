import { ApiError, GoogleGenAI } from '@google/genai';
import { LlmError, type LlmClient, type LlmRequest } from './llm.js';

/** Adaptador Gemini (A08). La clave vive sólo en el backend. */
export class GeminiLlmClient implements LlmClient {
  private readonly ai: GoogleGenAI;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generateJson(request: LlmRequest): Promise<string> {
    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: request.prompt,
        config: {
          systemInstruction: request.systemInstruction,
          responseMimeType: 'application/json',
          responseJsonSchema: request.responseJsonSchema,
          maxOutputTokens: request.maxOutputTokens,
          temperature: 0.2,
          abortSignal: request.signal,
        },
      });
      return response.text ?? '';
    } catch (err) {
      if (request.signal.aborted) throw new LlmError('timeout', 'Gemini no respondió a tiempo');
      if (err instanceof ApiError && err.status === 429) {
        throw new LlmError('quota', 'Cuota de Gemini agotada');
      }
      throw new LlmError('unavailable', err instanceof Error ? err.message : 'Error de Gemini');
    }
  }
}
