import { describe, it, expect } from 'vitest';
import { expandForSpeech } from './tts-glossary';

describe('expandForSpeech — glossário de pronúncia do TTS', () => {
  it('expande "m²" para "metros quadrados"', () => {
    expect(expandForSpeech('O apartamento tem 50 m² de área útil.')).toBe(
      'O apartamento tem 50 metros quadrados de área útil.',
    );
  });

  it('expande "m³" para "metros cúbicos"', () => {
    expect(expandForSpeech('São 200 m³ de concreto.')).toBe('São 200 metros cúbicos de concreto.');
  });

  it('expande "km²" para "quilômetros quadrados" sem deixar resíduo de "m²"', () => {
    expect(expandForSpeech('O terreno tem 3 km² de extensão.')).toBe(
      'O terreno tem 3 quilômetros quadrados de extensão.',
    );
  });

  it('expande múltiplas ocorrências na mesma fala', () => {
    expect(expandForSpeech('60 m² no térreo e 40 m² no mezanino.')).toBe(
      '60 metros quadrados no térreo e 40 metros quadrados no mezanino.',
    );
  });

  it('texto sem abreviação passa direto', () => {
    expect(expandForSpeech('Vamos revisar o cronograma da obra.')).toBe(
      'Vamos revisar o cronograma da obra.',
    );
  });
});
