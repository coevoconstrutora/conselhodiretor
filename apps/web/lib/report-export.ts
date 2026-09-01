import 'server-only';
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, HeadingLevel, PageBreak } from 'docx';
import { formatDateTimeBR } from './format';

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
