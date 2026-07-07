import { describe, it, expect } from 'vitest';
import { parseCaseReview, CASE_REVIEW_SYSTEM } from './case-review';

describe('parseCaseReview (B4 — parse defensivo do roteador)', () => {
  it('skip explícito', () => {
    expect(parseCaseReview('{"skip":true}')).toEqual({ skip: true });
  });

  it('contribuição válida roteada', () => {
    expect(
      parseCaseReview('{"agentId":"mercado","type":"hipotese","severity":"normal","text":"Vale validar a demanda."}'),
    ).toEqual({ agentId: 'mercado', type: 'hipotese', severity: 'normal', text: 'Vale validar a demanda.' });
  });

  it('agentId INVENTADO pelo modelo → null (o código valida, não o modelo)', () => {
    expect(parseCaseReview('{"agentId":"dr-house","type":"sugestao","severity":"normal","text":"x"}')).toBeNull();
  });

  it('type/severity inválidos são normalizados; texto vazio → null; JSON quebrado → null', () => {
    expect(parseCaseReview('{"agentId":"cfo","type":"ordem","severity":"urgente","text":"Revisar o caixa."}')).toEqual({
      agentId: 'cfo',
      type: 'sugestao',
      severity: 'normal',
      text: 'Revisar o caixa.',
    });
    expect(parseCaseReview('{"agentId":"cfo","text":""}')).toBeNull();
    expect(parseCaseReview('não é json')).toBeNull();
  });

  it('system prompt: tom de sugestão + preferência por skip (anti-ruído)', () => {
    expect(CASE_REVIEW_SYSTEM).toContain('a decisão é sempre do empresário');
    expect(CASE_REVIEW_SYSTEM).toContain('PREFIRA skip');
  });
});
