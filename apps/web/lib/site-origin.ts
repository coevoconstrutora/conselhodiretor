import 'server-only';
import { headers } from 'next/headers';

/** Origem pública do site (proto+host) — usada em links de e-mail (reset de senha, credenciais). */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
