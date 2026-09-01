/**
 * Nomeia quem fala por AUTOAPRESENTAÇÃO — não é biometria de voz (mais
 * barato, sem LGPD de dado sensível, usa a diarização que já existe).
 *
 * A diarização do Deepgram (deepgram.ts) prefixa "Locutor N: " só na
 * PRIMEIRA fala de um locutor depois de uma troca de turno. Quando isso
 * acontece, procuramos um padrão de autoapresentação ("sou a Marina",
 * "aqui é o Carlos", "meu nome é Ana") NESSA MESMA fala; se achar, o rótulo
 * vira o nome dali em diante — só para esta sessão ao vivo (reseta a cada
 * reunião nova, igual à diarização em si).
 */

export interface SpeakerNameTracker {
  /** Aplica os nomes já conhecidos e aprende um nome novo se esta fala se autoapresentar. */
  apply(text: string): string;
  /**
   * Tier 2 — correção manual: o dono nomeia/corrige um "Locutor N" na hora,
   * quando ninguém se apresentou (ou a autoapresentação errou o nome). Vale
   * a partir da PRÓXIMA fala daquele número — não reescreve o que já foi
   * transcrito (mesma regra da autoapresentação).
   */
  override(speakerNum: string, name: string): void;
}

const SPEAKER_PREFIX_RE = /^Locutor (\d+): /;

/** "sou o/a NOME [da/do (área) ÁREA]" cobre a maior parte das autoapresentações em pt-BR. */
const INTRO_PATTERNS: RegExp[] = [
  /\bsou\s+(?:a|o)\s+([a-zà-ÿ]+(?:\s+[a-zà-ÿ]+){0,2})/i,
  /\b(?:aqui é|aqui quem fala é|aqui fala)\s+(?:a|o)\s+([a-zà-ÿ]+(?:\s+[a-zà-ÿ]+){0,2})/i,
  /\bmeu nome é\s+([a-zà-ÿ]+(?:\s+[a-zà-ÿ]+){0,2})/i,
];

function titleCase(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function extractSelfIntroName(text: string): string | null {
  for (const re of INTRO_PATTERNS) {
    const match = re.exec(text);
    if (match?.[1]) return titleCase(match[1]);
  }
  return null;
}

/** 1 instância por reunião AO VIVO. */
export function createSpeakerNameTracker(): SpeakerNameTracker {
  const names = new Map<string, string>(); // "1" -> "Marina"

  return {
    apply(text: string): string {
      const match = SPEAKER_PREFIX_RE.exec(text);
      if (!match) return text; // continuação do mesmo locutor — sem rótulo, nada a fazer
      const speakerNum = match[1]!;
      const rest = text.slice(match[0].length);

      const introName = extractSelfIntroName(rest);
      if (introName) names.set(speakerNum, introName);

      const known = names.get(speakerNum);
      return known ? `${known}: ${rest}` : text;
    },
    override(speakerNum: string, name: string): void {
      const trimmed = name.trim();
      if (trimmed) names.set(speakerNum, titleCase(trimmed));
    },
  };
}
