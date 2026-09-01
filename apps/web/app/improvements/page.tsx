import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listMeetingImprovements } from '@conselho/meeting-report';
import { requireCurrentUser, canWrite } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { formatDateTimeBR } from '@/lib/format';

/**
 * Aprendizado do produto: o que a análise automática pós-reunião apontou que
 * daria pra melhorar no PRÓPRIO Conselho (nunca no negócio da empresa) — só
 * LEITURA por enquanto, nada aqui é aplicado sozinho no sistema.
 */
export default async function ImprovementsPage() {
  const user = await requireCurrentUser();
  if (!canWrite(user)) redirect('/');

  const db = await getDb();
  const improvements = await listMeetingImprovements(db, user.companyId, getEncryptionKey());

  return (
    <main className="mx-auto min-h-screen max-w-4xl p-6 sm:p-8">
      <header className="border-b border-ink/10 pb-5">
        <Link href="/" className="text-sm text-ink-muted hover:text-ink hover:underline">
          ← Painel
        </Link>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">
          🧠 Melhorias sugeridas
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          A cada reunião encerrada, uma análise automática aponta o que daria pra melhorar no
          Conselho em si (gatilhos, repetição de fórmula, tom, lacuna de base de conhecimento) —
          nunca conselho de negócio. Isto é só um registro para aprendizado: nada aqui é aplicado
          sozinho no sistema.
        </p>
      </header>

      {improvements.length === 0 ? (
        <p className="mt-8 rounded-[var(--radius)] border border-dashed border-ink/15 p-6 text-sm text-ink-muted">
          Nenhuma análise ainda — encerre uma reunião para gerar a primeira.
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {improvements.map((item) => (
            <li key={item.id} className="card-premium p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`/meetings/${item.meetingId}`}
                  className="text-sm font-semibold text-ink hover:underline"
                >
                  {item.meetingTitle}
                </Link>
                <span className="text-[11px] text-ink-muted">
                  {formatDateTimeBR(item.createdAt)}
                  {item.modelVersion ? ` · ${item.modelVersion}` : ''}
                </span>
              </div>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink">
                {item.content}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
