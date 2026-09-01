/**
 * Glossário de pronúncia pro TTS: alguns símbolos/abreviações do domínio
 * imobiliário saem errados numa leitura literal (ex.: "m²" tende a virar
 * "m 2" ou ser ignorado pelo modelo de voz). Aqui a gente expande pra forma
 * FALADA antes de mandar pro TTS — nunca aplicado ao texto EXIBIDO na tela
 * (transcrição/feed/relatórios continuam mostrando "m²", só a fala muda).
 *
 * Crescer este glossário é só adicionar uma linha — não precisa mexer no
 * resto do pipeline de voz.
 */
const PRONUNCIATION_GLOSSARY: ReadonlyArray<readonly [RegExp, string]> = [
  // "km²" precisa vir ANTES de "m²" — senão "m²" já teria consumido o "m²"
  // dentro de "km²", sobrando um "k" solto sem nunca casar com /km²/.
  [/km²/gi, 'quilômetros quadrados'],
  [/m²/gi, 'metros quadrados'],
  [/m³/gi, 'metros cúbicos'],
];

export function expandForSpeech(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PRONUNCIATION_GLOSSARY) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
