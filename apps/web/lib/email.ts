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

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(`[email] RESEND_API_KEY ausente — e-mail p/ ${to} (${subject}) não enviado, só logado:\n${html}`);
    return;
  }

  const from = process.env.EMAIL_FROM || DEFAULT_FROM;
  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
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
