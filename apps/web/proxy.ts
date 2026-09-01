import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateSession } from '@conselho/auth';
import { SESSION_COOKIE } from '@/lib/auth';
import { getDb } from '@/lib/db';

/**
 * Gate de autenticação GLOBAL (Next 16: "proxy", antigo "middleware") —
 * antes desta etapa, cada página chamava `getCurrentUser()` manualmente
 * (fácil esquecer numa rota nova, deixando-a aberta por padrão). Proxy
 * sempre roda em Node.js (não Edge): a sessão é validada contra o banco
 * (token opaco, sem JWT) — o mesmo mecanismo de `getCurrentUser()`, não
 * uma verificação superficial de cookie presente.
 *
 * `/api/*` fica de fora: cada rota já responde 401 em JSON (não faz sentido
 * redirecionar um consumidor de API pra uma página HTML de login).
 */

const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password'];

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    const session = await validateSession(db, token);
    if (session) return NextResponse.next();
  }

  const loginUrl = new URL('/login', request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
