import { describe, it, expect } from 'vitest';
import { capReasoningEffort } from './president-config';

describe('capReasoningEffort — teto de raciocínio (custo)', () => {
  it('rebaixa esforços acima do teto', () => {
    expect(capReasoningEffort('xhigh', 'medium')).toBe('medium');
    expect(capReasoningEffort('high', 'medium')).toBe('medium');
  });

  it('mantém esforços iguais ou abaixo do teto', () => {
    expect(capReasoningEffort('medium', 'medium')).toBe('medium');
    expect(capReasoningEffort('low', 'medium')).toBe('low');
    expect(capReasoningEffort('none', 'medium')).toBe('none');
  });

  it('valor ausente ou desconhecido cai no teto', () => {
    expect(capReasoningEffort(undefined, 'medium')).toBe('medium');
    expect(capReasoningEffort('max', 'medium')).toBe('medium');
  });
});
