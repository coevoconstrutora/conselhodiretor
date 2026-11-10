/**
 * Trava de "conteúdo mínimo" da transcrição — a IA só pode relatar o que foi
 * DITO. Uma reunião que teve só "bom dia, ok" (ou um teste de microfone) não
 * tem conteúdo para relatório, decisão, ação nem ata; sem esta trava os
 * modelos preenchem o vazio com recomendações genéricas, e a extração as
 * promove a "decisões/ações" (incidente de 2026-11-10: "Bom dia. Ok." gerou
 * 11 decisões e 11 ações).
 */

/** Palavras com substância abaixo disso ⇒ reunião sem conteúdo analisável. */
export const MIN_SUBSTANTIVE_WORDS = 25;

/** Saudações, ruído de teste de som e funcionais — não contam como conteúdo. */
const NON_SUBSTANTIVE = new Set([
  'bom', 'boa', 'dia', 'tarde', 'noite', 'ola', 'oi', 'alo', 'tchau', 'obrigado', 'obrigada', 'valeu',
  'ok', 'okay', 'certo', 'sim', 'nao', 'ne', 'ta', 'tá', 'tudo', 'bem', 'entao', 'pronto', 'beleza',
  'teste', 'testando', 'testar', 'som', 'audio', 'microfone', 'gravando', 'ouvindo', 'ouvem', 'escutando',
  'hum', 'ahn', 'eh', 'uh', 'aham', 'uhum', 'um', 'dois', 'tres',
  'que', 'com', 'para', 'por', 'uma', 'uns', 'umas', 'dos', 'das', 'nos', 'nas', 'mas', 'mais', 'como',
  'foi', 'ser', 'sao', 'esta', 'estao', 'isso', 'esse', 'essa', 'este', 'aqui', 'ali', 'ainda', 'ja',
  'vou', 'vai', 'vamos', 'ele', 'ela', 'eles', 'elas', 'seu', 'sua', 'meu', 'minha', 'nosso', 'nossa',
  'muito', 'pouco', 'agora', 'depois', 'antes', 'tambem', 'quando', 'onde', 'qual', 'quem',
]);

function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export interface TranscriptSubstance {
  readonly sufficient: boolean;
  /** Palavras com substância (sem saudações/ruído/palavras funcionais). */
  readonly substantiveWords: number;
}

export function assessTranscriptSubstance(finals: readonly string[]): TranscriptSubstance {
  let substantiveWords = 0;
  for (const text of finals) {
    // remove o rótulo de locutor ("Locutor 1:", "Marina:") antes de contar
    const body = text.replace(/^\s*[\p{L}\p{N} .]{1,40}:\s+/u, '');
    for (const raw of body.match(/[\p{L}\p{N}]+/gu) ?? []) {
      const word = normalizeWord(raw);
      if (word.length <= 2 || NON_SUBSTANTIVE.has(word)) continue;
      substantiveWords++;
    }
  }
  return { sufficient: substantiveWords >= MIN_SUBSTANTIVE_WORDS, substantiveWords };
}

const FOOTER = '_Rascunho gerado por IA — revisado e validado pelo responsável._';

function reason(substance: TranscriptSubstance): string {
  return (
    `A transcrição desta reunião tem conteúdo insuficiente (${substance.substantiveWords} palavra(s) com ` +
    'substância — apenas saudações ou teste de áudio), então não há o que analisar.'
  );
}

/** Texto fixo (sem chamar a IA) para o relatório de um conselheiro quando não houve conteúdo. */
export function insufficientCounselorReport(substance: TranscriptSubstance): string {
  return (
    `## Minha leitura da reunião\n${reason(substance)}\n\n` +
    '## Riscos no meu escopo\nNenhum registrado — nada foi discutido.\n\n' +
    '## Oportunidades\nNenhuma registrada — nada foi discutido.\n\n' +
    '## Recomendações\nNenhuma. Não faço recomendações sem que o tema tenha sido tratado na reunião.\n\n' +
    FOOTER
  );
}

export function insufficientPresidentSynthesis(substance: TranscriptSubstance): string {
  return (
    `## Visão geral do Presidente\n${reason(substance)} Não há sugestões de conselheiros a analisar.\n\n` +
    'A decisão é sua.\n\n' +
    FOOTER
  );
}

export function insufficientSecretaryMinutes(substance: TranscriptSubstance): string {
  return (
    `## Ata da Reunião\n${reason(substance)}\n\n` +
    '## Resumo da Discussão\nNão houve discussão.\n\n' +
    '## Decisões Tomadas\nNenhuma.\n\n' +
    '## Metas Estabelecidas\nNenhuma.\n\n' +
    '## Ações a Realizar\nNenhuma.\n\n' +
    '## Pendências\nNenhuma.\n\n' +
    '_Ata gerada por IA — revisada e validada pelo responsável._'
  );
}
