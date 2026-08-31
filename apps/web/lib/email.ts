import 'server-only';

/**
 * Envio de e-mail transacional via Resend (API HTTP direta, sem SDK de vendor
 * — mesmo padrão dos adapters de LLM). Hoje só usado para recuperação de senha.
 *
 * RESEND_API_KEY ausente: loga o link no servidor em vez de enviar (permite
 * testar o fluxo em dev sem depender de domínio verificado no Resend).
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Conselho <nao-responda@coevoconstrutora.com.br>';

export class EmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailError';
  }
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(`[email] RESEND_API_KEY ausente — link de recuperação para ${to}: ${resetUrl}`);
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
      subject: 'Redefinir sua senha — Conselho',
      html: `
        <p>Você pediu para redefinir a senha da sua conta no Conselho.</p>
        <p><a href="${resetUrl}">Clique aqui para escolher uma nova senha</a> (o link expira em 1 hora).</p>
        <p>Se não foi você, ignore este e-mail — sua senha continua a mesma.</p>
      `.trim(),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new EmailError(`Resend falhou (${response.status}): ${body.slice(0, 200)}`);
  }
}
