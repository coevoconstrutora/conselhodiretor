import 'server-only';

/**
 * Envio de e-mail transacional via Resend (API HTTP direta, sem SDK de vendor
 * — mesmo padrão dos adapters de LLM). Usado para recuperação de senha e
 * envio de credenciais (URL/e-mail/senha) na criação/reset de usuário.
 *
 * RESEND_API_KEY ausente: loga o conteúdo no servidor em vez de enviar
 * (permite testar o fluxo em dev sem depender de domínio verificado no Resend).
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Conselho <nao-responda@coevoconstrutora.com.br>';

export class EmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailError';
  }
}

export interface EmailAttachment {
  readonly filename: string;
  /** Conteúdo binário do anexo — convertido para base64 antes de ir pro Resend. */
  readonly content: Buffer;
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  attachments?: readonly EmailAttachment[],
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      `[email] RESEND_API_KEY ausente — e-mail p/ ${to} (${subject}${attachments?.length ? `, ${attachments.length} anexo(s)` : ''}) não enviado, só logado:\n${html}`,
    );
    return;
  }

  const from = process.env.EMAIL_FROM || DEFAULT_FROM;
  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      attachments: attachments?.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new EmailError(`Resend falhou (${response.status}): ${body.slice(0, 200)}`);
  }
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await sendEmail(
    to,
    'Redefinir sua senha — Conselho',
    `
      <p>Você pediu para redefinir a senha da sua conta no Conselho.</p>
      <p><a href="${resetUrl}">Clique aqui para escolher uma nova senha</a> (o link expira em 1 hora).</p>
      <p>Se não foi você, ignore este e-mail — sua senha continua a mesma.</p>
    `.trim(),
  );
}

/** Envia os relatórios finais de uma reunião (PDF anexado) — botão "Enviar por e-mail". */
export async function sendReportsEmail(
  to: string,
  meetingTitle: string,
  pdfBuffer: Buffer,
): Promise<void> {
  await sendEmail(
    to,
    `Relatórios do Conselho — ${meetingTitle}`,
    `
      <p>Segue em anexo (PDF) os relatórios do conselho para a reunião <strong>${meetingTitle}</strong>.</p>
      <p>Lembrete: são rascunhos gerados por IA, revisados/editados pelo empresário antes do envio — a decisão é sempre sua.</p>
    `.trim(),
    [{ filename: 'relatorios-conselho.pdf', content: pdfBuffer }],
  );
}

/** Envia URL de acesso + usuário (e-mail) + senha — usado ao criar/resetar um usuário pelo painel. */
export async function sendCredentialsEmail(
  to: string,
  credentials: { accessUrl: string; email: string; password: string },
): Promise<void> {
  await sendEmail(
    to,
    'Seu acesso ao Conselho',
    `
      <p>Seu acesso ao Conselho foi criado (ou a senha foi redefinida). Dados de acesso:</p>
      <p>
        <strong>URL de Acesso:</strong> <a href="${credentials.accessUrl}">${credentials.accessUrl}</a><br>
        <strong>Usuário:</strong> ${credentials.email}<br>
        <strong>Senha:</strong> ${credentials.password}
      </p>
      <p>Por segurança, recomendamos trocar a senha após o primeiro acesso.</p>
    `.trim(),
  );
}
