import { describe, it, expect } from 'vitest';
import {
  isValidAiModel,
  isValidReasoningEffort,
  isValidVoice,
  isValidSpeechRate,
  findReasoningModel,
  REASONING_MODELS,
  REASONING_EFFORTS,
  VOICES,
  SPEECH_RATES,
} from './ai-config';

describe('ai-config — validação server-side (Etapa "IA por conselheiro")', () => {
  it('isValidAiModel aceita só os 3 modelos suportados', () => {
    expect(isValidAiModel('gpt-5.6-luna')).toBe(true);
    expect(isValidAiModel('gpt-5.6-terra')).toBe(true);
    expect(isValidAiModel('gpt-5.6-sol')).toBe(true);
    expect(isValidAiModel('gpt-4o')).toBe(false);
    expect(isValidAiModel('gpt-5.6-luna; DROP TABLE agent_profile')).toBe(false);
    expect(isValidAiModel(undefined)).toBe(false);
    expect(isValidAiModel(null)).toBe(false);
  });

  it('isValidReasoningEffort aceita só os 6 níveis suportados', () => {
    for (const level of ['none', 'low', 'medium', 'high', 'xhigh', 'max']) {
      expect(isValidReasoningEffort(level)).toBe(true);
    }
    expect(isValidReasoningEffort('minimal')).toBe(false); // valor antigo, não suportado no gpt-5.6
    expect(isValidReasoningEffort('ultra')).toBe(false);
  });

  it('isValidVoice aceita só as 9 vozes do endpoint de fala', () => {
    expect(isValidVoice('onyx')).toBe(true);
    expect(isValidVoice('ballad')).toBe(false); // existe no catálogo geral da OpenAI, mas rejeitado por esse endpoint
    expect(isValidVoice('verse')).toBe(false);
    expect(isValidVoice('')).toBe(false);
  });

  it('isValidSpeechRate aceita só os 4 valores do select compacto', () => {
    expect(isValidSpeechRate(0.9)).toBe(true);
    expect(isValidSpeechRate(1.0)).toBe(true);
    expect(isValidSpeechRate(1.1)).toBe(true);
    expect(isValidSpeechRate(1.2)).toBe(true);
    expect(isValidSpeechRate(2.5)).toBe(false); // fora da lista — nunca aceitar input numérico livre
    expect(isValidSpeechRate('1.0')).toBe(false); // string, não number
  });

  it('findReasoningModel devolve a descrição do modelo certo', () => {
    expect(findReasoningModel('gpt-5.6-sol')?.description).toContain('Maior capacidade analítica');
    expect(findReasoningModel('modelo-inexistente')).toBeUndefined();
  });

  it('todas as listas de opções têm valores únicos (sem duplicidade acidental)', () => {
    expect(new Set(REASONING_MODELS.map((m) => m.value)).size).toBe(REASONING_MODELS.length);
    expect(new Set(REASONING_EFFORTS.map((e) => e.value)).size).toBe(REASONING_EFFORTS.length);
    expect(new Set(VOICES.map((v) => v.value)).size).toBe(VOICES.length);
    expect(new Set(SPEECH_RATES.map((r) => r.value)).size).toBe(SPEECH_RATES.length);
  });
});
