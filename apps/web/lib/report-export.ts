import 'server-only';
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, HeadingLevel, PageBreak } from 'docx';
import PptxGenJS from 'pptxgenjs';
import type {
  MeetingDecisionRecord,
  MeetingActionItemRecord,
  DecisionStatus,
  ActionItemStatus,
} from '@conselho/meeting-report';
import { formatDateTimeBR, formatDateBR } from './format';
import { getAgentEmoji } from './agent-display';

// Interop de dual package: sob Next/webpack o default import já é o
// construtor; em alguns runtimes ESM (confirmado com `tsx`, usado só no
// smoke test manual deste arquivo) ele chega envelopado em `.default`.
// Cobre os dois casos sem custo no caminho normal.
const PptxGenJSCtor = ((PptxGenJS as unknown as { default?: typeof PptxGenJS }).default ??
  PptxGenJS) as typeof PptxGenJS;

/**
 * Exportação dos relatórios finais da reunião em PDF/Word — rascunhos
 * markdown-leve (`packages/meeting-report`) viram documento formatado.
 * Não interpreta markdown completo (sem tabelas/links), só o suficiente pro
 * que o LLM realmente produz: `## títulos`, listas com `-`/`*`, parágrafos.
 */

export interface ReportExportItem {
  readonly agentId: string;
  readonly displayName: string;
  readonly content: string;
  readonly updatedAt: Date;
}

function markdownLines(content: string): { kind: 'h1' | 'h2' | 'bullet' | 'p' | 'blank'; text: string }[] {
  return content.split('\n').map((raw) => {
    const line = raw.trim();
    if (!line) return { kind: 'blank', text: '' };
    if (line.startsWith('## ')) return { kind: 'h2', text: line.slice(3) };
    if (line.startsWith('# ')) return { kind: 'h1', text: line.slice(2) };
    if (/^[-*]\s+/.test(line)) return { kind: 'bullet', text: line.replace(/^[-*]\s+/, '') };
    return { kind: 'p', text: line };
  });
}

export async function buildReportsPdf(meetingTitle: string, reports: readonly ReportExportItem[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text(`Relatórios do Conselho`, { align: 'left' });
    doc.fontSize(14).fillColor('#555').text(meetingTitle);
    doc.fontSize(9).fillColor('#888').text(`Gerado em ${formatDateTimeBR(new Date())}`);
    doc.fillColor('black');

    for (const report of reports) {
      doc.addPage();
      doc.fontSize(16).text(report.displayName, { underline: true });
      doc.fontSize(9).fillColor('#888').text(`Atualizado em ${formatDateTimeBR(report.updatedAt)}`);
      doc.fillColor('black').moveDown(0.6);

      for (const line of markdownLines(report.content)) {
        switch (line.kind) {
          case 'blank':
            doc.moveDown(0.4);
            break;
          case 'h1':
            doc.moveDown(0.3).fontSize(14).text(line.text).fontSize(11);
            break;
          case 'h2':
            doc.moveDown(0.3).fontSize(13).text(line.text).fontSize(11);
            break;
          case 'bullet':
            doc.fontSize(11).text(`•  ${line.text}`, { indent: 15 });
            break;
          default:
            doc.fontSize(11).text(line.text);
        }
      }
    }

    doc.end();
  });
}

export async function buildReportsDocx(meetingTitle: string, reports: readonly ReportExportItem[]): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ text: 'Relatórios do Conselho', heading: HeadingLevel.TITLE }),
    new Paragraph({ text: meetingTitle, heading: HeadingLevel.HEADING_3 }),
    new Paragraph({ text: `Gerado em ${formatDateTimeBR(new Date())}` }),
  ];

  reports.forEach((report, idx) => {
    if (idx > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({ text: report.displayName, heading: HeadingLevel.HEADING_1 }));
    children.push(new Paragraph({ text: `Atualizado em ${formatDateTimeBR(report.updatedAt)}` }));
    children.push(new Paragraph({ text: '' }));

    for (const line of markdownLines(report.content)) {
      switch (line.kind) {
        case 'blank':
          children.push(new Paragraph({ text: '' }));
          break;
        case 'h1':
          children.push(new Paragraph({ text: line.text, heading: HeadingLevel.HEADING_1 }));
          break;
        case 'h2':
          children.push(new Paragraph({ text: line.text, heading: HeadingLevel.HEADING_2 }));
          break;
        case 'bullet':
          children.push(new Paragraph({ text: line.text, bullet: { level: 0 } }));
          break;
        default:
          children.push(new Paragraph({ text: line.text }));
      }
    }
  });

  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

/**
 * Exportação em slides (PowerPoint) — 1 overview por conselheiro, síntese do
 * Presidente, decisões/ações e ata da Secretária. Só faz sentido com o
 * conselho completo já gerado (o chamador, `report-export/route.ts`, garante
 * isso antes de chamar). Reaproveita o conteúdo dos relatórios como estão
 * (sem resumo por IA à parte) — mesmo texto que já existe, só formatado pro
 * slide com fonte auto-ajustável (`shrinkText`) pra caber numa página só.
 */

const NAVY = '13294B';
const INK = '1F2937';
const MUTED = '6B7280';

const DECISION_STATUS_LABEL: Record<DecisionStatus, string> = {
  decidido: 'Decidido',
  recomendado: 'Recomendado',
  pendente: 'Pendente',
  cancelado: 'Cancelado',
};
const DECISION_STATUS_COLOR: Record<DecisionStatus, string> = {
  decidido: '15803D',
  recomendado: '1D4ED8',
  pendente: 'B45309',
  cancelado: 'B91C1C',
};
const ACTION_STATUS_LABEL: Record<ActionItemStatus, string> = {
  pendente: 'Pendente',
  concluida: 'Concluída',
};
const ACTION_STATUS_COLOR: Record<ActionItemStatus, string> = {
  pendente: 'B45309',
  concluida: '15803D',
};

/** Slide inteiro (13.33" x 7.5") menos margem de 0.5" de cada lado. */
const CONTENT_W = 12.33;

function buildTextRuns(content: string): PptxGenJS.TextProps[] {
  return markdownLines(content).flatMap((line): PptxGenJS.TextProps[] => {
    switch (line.kind) {
      case 'blank':
        return [{ text: '', options: { breakLine: true, fontSize: 6 } }];
      case 'h1':
        return [{ text: line.text, options: { bold: true, fontSize: 15, color: NAVY, breakLine: true } }];
      case 'h2':
        return [{ text: line.text, options: { bold: true, fontSize: 13, color: NAVY, breakLine: true } }];
      case 'bullet':
        return [{ text: line.text, options: { bullet: true, fontSize: 11, color: INK, breakLine: true } }];
      default:
        return [{ text: line.text, options: { fontSize: 11, color: INK, breakLine: true } }];
    }
  });
}

function addContentSlide(
  pptx: PptxGenJS,
  opts: { readonly title: string; readonly subtitle: string; readonly content: string },
): void {
  const slide = pptx.addSlide();
  slide.addText(opts.title, {
    x: 0.5, y: 0.35, w: CONTENT_W, h: 0.6,
    fontSize: 22, bold: true, color: NAVY, fontFace: 'Calibri',
  });
  slide.addText(opts.subtitle, {
    x: 0.5, y: 0.92, w: CONTENT_W, h: 0.3,
    fontSize: 9, color: MUTED, fontFace: 'Calibri',
  });
  slide.addText(buildTextRuns(opts.content), {
    x: 0.5, y: 1.4, w: CONTENT_W, h: 5.6,
    fontFace: 'Calibri', valign: 'top', autoFit: true, shrinkText: true,
  });
}

function addDecisionsSlide(pptx: PptxGenJS, decisions: readonly MeetingDecisionRecord[]): void {
  const slide = pptx.addSlide();
  slide.addText('📋 Decisões', {
    x: 0.5, y: 0.35, w: CONTENT_W, h: 0.6, fontSize: 22, bold: true, color: NAVY, fontFace: 'Calibri',
  });
  const headerFill = { color: NAVY };
  const header: PptxGenJS.TableRow = ['Tópico', 'Decisão', 'Status', 'Responsável', 'Prazo'].map((text) => ({
    text,
    options: { bold: true, color: 'FFFFFF', fill: headerFill, fontSize: 11, fontFace: 'Calibri' },
  }));
  const rows: PptxGenJS.TableRow[] = decisions.map((d) => [
    { text: d.topic, options: { fontSize: 10, fontFace: 'Calibri' } },
    { text: d.decision, options: { fontSize: 10, fontFace: 'Calibri' } },
    {
      text: DECISION_STATUS_LABEL[d.status],
      options: { fontSize: 10, bold: true, color: DECISION_STATUS_COLOR[d.status], fontFace: 'Calibri' },
    },
    { text: d.responsible || '—', options: { fontSize: 10, fontFace: 'Calibri' } },
    { text: d.deadline ? formatDateBR(d.deadline) : '—', options: { fontSize: 10, fontFace: 'Calibri' } },
  ]);
  slide.addTable([header, ...rows], {
    x: 0.5, y: 1.1, w: CONTENT_W,
    colW: [2.3, 4.7, 1.3, 2.03, 2.0],
    border: { type: 'solid', color: 'E5E7EB', pt: 0.5 },
    autoPage: true,
    autoPageRepeatHeader: true,
    autoPageHeaderRows: 1,
  });
}

function addActionItemsSlide(pptx: PptxGenJS, actionItems: readonly MeetingActionItemRecord[]): void {
  const slide = pptx.addSlide();
  slide.addText('✅ Ações', {
    x: 0.5, y: 0.35, w: CONTENT_W, h: 0.6, fontSize: 22, bold: true, color: NAVY, fontFace: 'Calibri',
  });
  const headerFill = { color: NAVY };
  const header: PptxGenJS.TableRow = ['Ação', 'Responsável', 'Prazo', 'Status'].map((text) => ({
    text,
    options: { bold: true, color: 'FFFFFF', fill: headerFill, fontSize: 11, fontFace: 'Calibri' },
  }));
  const rows: PptxGenJS.TableRow[] = actionItems.map((a) => [
    { text: a.action, options: { fontSize: 10, fontFace: 'Calibri' } },
    { text: a.responsible || '—', options: { fontSize: 10, fontFace: 'Calibri' } },
    { text: a.deadline ? formatDateBR(a.deadline) : '—', options: { fontSize: 10, fontFace: 'Calibri' } },
    {
      text: ACTION_STATUS_LABEL[a.status],
      options: { fontSize: 10, bold: true, color: ACTION_STATUS_COLOR[a.status], fontFace: 'Calibri' },
    },
  ]);
  slide.addTable([header, ...rows], {
    x: 0.5, y: 1.1, w: CONTENT_W,
    colW: [5.5, 3.0, 1.83, 2.0],
    border: { type: 'solid', color: 'E5E7EB', pt: 0.5 },
    autoPage: true,
    autoPageRepeatHeader: true,
    autoPageHeaderRows: 1,
  });
}

export interface PptxReportInput {
  readonly meetingTitle: string;
  readonly presidentReport: ReportExportItem | null;
  readonly counselorReports: readonly ReportExportItem[];
  readonly secretaryReport: ReportExportItem | null;
  readonly decisions: readonly MeetingDecisionRecord[];
  readonly actionItems: readonly MeetingActionItemRecord[];
}

export async function buildReportsPptx(input: PptxReportInput): Promise<Buffer> {
  const pptx = new PptxGenJSCtor();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `Relatório do Conselho — ${input.meetingTitle}`;

  const cover = pptx.addSlide();
  cover.background = { color: NAVY };
  cover.addText('Relatório do Conselho', {
    x: 0.8, y: 2.6, w: 11.73, h: 1, fontSize: 34, bold: true, color: 'FFFFFF', align: 'center', fontFace: 'Calibri',
  });
  cover.addText(input.meetingTitle, {
    x: 0.8, y: 3.6, w: 11.73, h: 0.6, fontSize: 18, color: 'D7DEE8', align: 'center', fontFace: 'Calibri',
  });
  cover.addText(`Gerado em ${formatDateTimeBR(new Date())}`, {
    x: 0.8, y: 4.2, w: 11.73, h: 0.4, fontSize: 11, color: '9AA5B1', align: 'center', fontFace: 'Calibri',
  });

  if (input.presidentReport) {
    addContentSlide(pptx, {
      title: '⭐ Síntese do Presidente',
      subtitle: `Atualizado em ${formatDateTimeBR(input.presidentReport.updatedAt)}`,
      content: input.presidentReport.content,
    });
  }

  for (const report of input.counselorReports) {
    addContentSlide(pptx, {
      title: `${getAgentEmoji(report.agentId)}  ${report.displayName}`,
      subtitle: `Atualizado em ${formatDateTimeBR(report.updatedAt)}`,
      content: report.content,
    });
  }

  if (input.decisions.length > 0) addDecisionsSlide(pptx, input.decisions);
  if (input.actionItems.length > 0) addActionItemsSlide(pptx, input.actionItems);

  if (input.secretaryReport) {
    addContentSlide(pptx, {
      title: '📝 Ata da Secretária',
      subtitle: `Atualizado em ${formatDateTimeBR(input.secretaryReport.updatedAt)}`,
      content: input.secretaryReport.content,
    });
  }

  const out = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as Uint8Array);
}
