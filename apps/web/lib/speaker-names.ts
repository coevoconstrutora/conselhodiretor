/**
 * Nomeia quem fala por AUTOAPRESENTAÇÃO — não é biometria de voz (mais
 * barato, sem LGPD de dado sensível, usa a diarização que já existe).
 *
 * A diarização do Deepgram (deepgram.ts) prefixa "Locutor N: " só na
 * PRIMEIRA fala de um locutor depois de uma troca de turno. Quando isso
 * acontece, procuramos um padrão de autoapresentação ("sou a Marina, da
 * área Jurídica", "aqui é o Carlos", "meu nome é Ana") NESSA MESMA fala; se
 * achar, o rótulo vira o nome (+ área, se mencionada) dali em diante — só
 * para esta sessão ao vivo (reseta a cada reunião nova, igual à diarização).
 */

export interface KnownSpeaker {
  readonly speakerNum: string;
  readonly name: string;
  readonly area: string | null;
}

export interface SpeakerNameTracker {
  /** Aplica os nomes já conhecidos e aprende um nome novo se esta fala se autoapresentar. */
  apply(text: string): string;
  /**
   * Tier 2 — correção manual: o dono nomeia/corrige um "Locutor N" na hora,
   * quando ninguém se apresentou (ou a autoapresentação errou o nome/área).
   * Vale a partir da PRÓXIMA fala daquele número — não reescreve o que já
   * foi transcrito (mesma regra da autoapresentação). `area` omitida mantém
   * a área já conhecida (se houver).
   */
  override(speakerNum: string, name: string, area?: string | null): void;
  /** Locutores já identificados nesta reunião (nome + área, se souber) — pro roster visível. */
  listKnown(): readonly KnownSpeaker[];
}

const SPEAKER_PREFIX_RE = /^Locutor (\d+): /;

/**
 * Extrai o número do locutor quando o texto AINDA está com o rótulo cru
 * "Locutor N: " (autoapresentação/renomeação/reconhecimento de voz ainda não
 * resolveu esse número) — usado pelo cliente (`live-mic-button.tsx`) pra
 * saber quando vale a pena tentar reconhecimento de voz ao vivo. `null` se o
 * texto já tem um nome resolvido.
 */
export function unresolvedSpeakerNum(text: string): string | null {
  return SPEAKER_PREFIX_RE.exec(text)?.[1] ?? null;
}
const NAME_GROUP = '([a-zà-ÿ]+(?:\\s+[a-zà-ÿ]+){0,2})';
// área só conta com uma palavra-chave explícita ("área/departamento/setor") — sem
// isso, um "do lado de fora" ou "do outro prédio" viraria uma "área" inventada.
const AREA_GROUP = '(?:,?\\s*d[aoe]s?\\s+(?:área|departamento|setor)\\s+(?:de\\s+)?([a-zà-ÿ]+(?:\\s+[a-zà-ÿ]+){0,2}))?';

/** "sou o/a NOME [da área/do departamento/do setor ÁREA]" cobre a maior parte das autoapresentações em pt-BR. */
const INTRO_PATTERNS: RegExp[] = [
  new RegExp(`\\bsou\\s+(?:a|o)\\s+${NAME_GROUP}${AREA_GROUP}`, 'i'),
  new RegExp(`\\b(?:aqui é|aqui quem fala é|aqui fala)\\s+(?:a|o)\\s+${NAME_GROUP}${AREA_GROUP}`, 'i'),
  new RegExp(`\\bmeu nome é\\s+${NAME_GROUP}${AREA_GROUP}`, 'i'),
];

function titleCase(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function extractSelfIntro(text: string): { name: string; area: string | null } | null {
  for (const re of INTRO_PATTERNS) {
    const match = re.exec(text);
    if (match?.[1]) {
      return { name: titleCase(match[1]), area: match[2] ? titleCase(match[2]) : null };
    }
  }
  return null;
}

/** 1 instância por reunião AO VIVO. */
export function createSpeakerNameTracker(): SpeakerNameTracker {
  const known = new Map<string, { name: string; area: string | null }>(); // "1" -> {name, area}

  return {
    apply(text: string): string {
      const match = SPEAKER_PREFIX_RE.exec(text);
      if (!match) return text; // continuação do mesmo locutor — sem rótulo, nada a fazer
      const speakerNum = match[1]!;
      const rest = text.slice(match[0].length);

      const intro = extractSelfIntro(rest);
      if (intro) known.set(speakerNum, intro);

      const entry = known.get(speakerNum);
      return entry ? `${entry.name}: ${rest}` : text;
    },
    override(speakerNum: string, name: string, area?: string | null): void {
      const trimmed = name.trim();
      if (!trimmed) return;
      const existing = known.get(speakerNum);
      const trimmedArea = area?.trim();
      known.set(speakerNum, {
        name: titleCase(trimmed),
        area: trimmedArea ? titleCase(trimmedArea) : (existing?.area ?? null),
      });
    },
    listKnown(): readonly KnownSpeaker[] {
      return [...known.entries()]
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([speakerNum, entry]) => ({ speakerNum, name: entry.name, area: entry.area }));
    },
  };
}
