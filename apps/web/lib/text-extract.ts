/**
 * Funções de extração/validação de fontes de conhecimento — separadas de
 * kb-sources.ts (que é server-only) para serem testáveis por unidade.
 */

/**
 * Extrai o texto de um PDF (`unpdf` — wrapper do pdf.js oficial da Mozilla,
 * sem serviço externo). Antes usava `pdf-parse@1.1.1` (parado desde ~2020,
 * empacota um pdf.js antigo): falhava com "bad XRef entry" em PDFs gerados
 * pelo NOSSO PRÓPRIO export (`report-export.ts`, via `pdfkit`) — alguém que
 * baixasse um relatório e tentasse reanexá-lo como fonte batia nisso. `unpdf`
 * resolve (testado contra um PDF real gerado por `pdfkit` neste repo).
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.trim();
}

/** Extrai o texto de um Word `.docx` (`mammoth` — só o `.docx` moderno, não o `.doc` binário antigo). */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ buffer });
  return value.trim();
}

const TEXT_FILE_RE = /\.(txt|md|markdown|csv)$/i;
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024; // 2 MB de texto puro
const MAX_BINARY_FILE_BYTES = 15 * 1024 * 1024; // 15 MB de PDF/DOCX (formato binário, mais pesado que o texto que carrega)

/**
 * Extrai o texto de um upload de fonte de conhecimento — `.txt/.md/.csv`
 * (direto), `.pdf` (`pdf-parse`) ou `.docx` (`mammoth`). Compartilhado entre
 * o "NotebookLM por conselheiro" e o perfil da empresa — mesmo formato,
 * mesmas regras, um lugar só para não divergir.
 */
export async function extractUploadedFileText(file: File): Promise<string> {
  const isText = TEXT_FILE_RE.test(file.name);
  const isPdf = /\.pdf$/i.test(file.name);
  const isDocx = /\.docx$/i.test(file.name);
  if (!isText && !isPdf && !isDocx) {
    throw new Error(
      'Formato não suportado. Envie .txt, .md, .csv, .pdf ou .docx (Word moderno — não o .doc antigo).',
    );
  }
  const maxBytes = isText ? MAX_TEXT_FILE_BYTES : MAX_BINARY_FILE_BYTES;
  if (file.size > maxBytes) {
    throw new Error(`Arquivo grande demais (máx. ${Math.round(maxBytes / (1024 * 1024))} MB).`);
  }

  let content: string;
  if (isText) {
    content = (await file.text()).trim();
  } else {
    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      content = isPdf ? await extractPdfText(buffer) : await extractDocxText(buffer);
    } catch (err) {
      console.error(`[upload] extração de ${isPdf ? 'PDF' : 'DOCX'} falhou:`, err);
      throw new Error(
        `Não foi possível extrair texto deste ${isPdf ? 'PDF' : 'arquivo Word'} — verifique se não é uma imagem escaneada sem texto (OCR não é suportado).`,
      );
    }
  }
  if (content.length < 20) throw new Error('O arquivo não tem texto útil extraível.');
  return content;
}

/** Remove tags/estilos/scripts de HTML e devolve texto legível por linhas. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** Bloqueia alvos privados óbvios (anti-SSRF) — produto single-tenant, defesa básica. */
export function isBlockedUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return true;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
  const host = url.hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '::1' ||
    host === '[::1]' ||
    host === '0.0.0.0' ||
    /^169\.254\./.test(host)
  );
}
