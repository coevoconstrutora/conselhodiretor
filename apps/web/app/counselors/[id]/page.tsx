import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getAgentProfiles } from '@conselho/kb';
import { ALL_AGENT_IDS, type AgentId } from '@conselho/providers';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { listKbSources, loadAndApplyProfileOverrides } from '@/lib/kb-sources';
import { deleteSourceAction } from '@/lib/counselor-actions';
import { ProfileForm, AddTextForm, AddUrlForm, AddFileForm } from '@/components/counselor-manager';

const AGENT_EMOJI: Record<string, string> = {
  engenharia: '🏗️',
  vendas: '📣',
  mercado: '📊',
  arquitetura: '📐',
  legal: '⚖️',
  cs: '🤝',
  cfo: '💰',
  futurista: '🔭',
  presidente: '⭐',
};

const KIND_LABEL: Record<string, string> = {
  text: '📄 texto',
  url: '🔗 link',
  file: '📎 arquivo',
};

/** "NotebookLM do conselheiro": perfil editável + fontes de conhecimento. */
export default async function CounselorPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;
  if (!(ALL_AGENT_IDS as readonly string[]).includes(id)) notFound();
  const agentId = id as AgentId;

  const db = await getDb();
  // perfis personalizados aplicados antes de ler (boot pode ter sido de outro processo)
  await loadAndApplyProfileOverrides(db, user.companyId);
  const profile = getAgentProfiles(user.companyId)[agentId];
  const isPresident = agentId === 'presidente';
  const sources = isPresident ? [] : await listKbSources(db, user.companyId, agentId, getEncryptionKey());
  const totalChars = sources.reduce((acc, s) => acc + s.chars, 0);

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-8">
      <header className="border-b border-ink/10 pb-5">
        <Link href="/" className="text-sm text-ink-muted hover:text-ink hover:underline">
          ← Painel
        </Link>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">
          <span aria-hidden="true" className="mr-2">
            {AGENT_EMOJI[agentId]}
          </span>
          {profile.displayName}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{profile.scope}</p>
      </header>

      {/* Perfil */}
      <section aria-label="Perfil do conselheiro" className="card-premium mt-8 p-6">
        <h2 className="font-display text-base font-semibold text-ink">
          <span className="blueprint-index mr-2 text-brand/70">01/</span>
          Perfil
        </h2>
        <p className="mb-4 text-xs text-ink-muted">
          O nome aparece nos cards e relatórios; o escopo vira REGRA no prompt — fora dele, o
          conselheiro não opina. Mudanças valem imediatamente.
        </p>
        <ProfileForm agentId={agentId} displayName={profile.displayName} scope={profile.scope} />
      </section>

      {isPresident ? (
        <section className="card-premium mt-6 p-6">
          <h2 className="font-display text-base font-semibold text-ink">
            <span className="blueprint-index mr-2 text-brand/70">02/</span>
            Base de conhecimento
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            O Presidente não tem base própria: o papel dele é <strong>sintetizar</strong> as
            contribuições dos outros 8 conselheiros e devolver a decisão a você. Para influenciar
            as sínteses, alimente as bases dos especialistas.
          </p>
        </section>
      ) : (
        <>
          {/* Fontes atuais */}
          <section aria-label="Fontes de conhecimento" className="card-premium mt-6 p-6">
            <h2 className="font-display text-base font-semibold text-ink">
              <span className="blueprint-index mr-2 text-brand/70">02/</span>
              Fontes de conhecimento
              <span className="ml-2 text-xs font-normal text-ink-muted">
                {sources.length} fonte(s)
                {totalChars > 0 ? ` · ${Math.max(1, Math.round(totalChars / 1000))}k caracteres` : ''}
                {' · + a base padrão do repositório'}
              </span>
            </h2>
            {sources.length === 0 ? (
              <p className="mt-3 rounded-[var(--radius)] border border-dashed border-ink/15 p-4 text-sm text-ink-muted">
                Nenhuma fonte própria ainda — este conselheiro usa só a base padrão. Adicione
                políticas internas, relatórios e lições da sua operação abaixo: é isso que torna o
                conselho <em>seu</em>.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-ink/10">
                {sources.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{s.title}</p>
                      <p className="text-[11px] text-ink-muted">
                        {KIND_LABEL[s.kind] ?? s.kind} · {Math.max(1, Math.round(s.chars / 1000))}k
                        chars · {s.createdAt.toLocaleDateString('pt-BR')}
                        {s.ref && s.kind === 'url' ? (
                          <>
                            {' · '}
                            <a
                              href={s.ref}
                              target="_blank"
                              rel="noreferrer"
                              className="underline hover:text-ink"
                            >
                              abrir origem
                            </a>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <form action={deleteSourceAction}>
                      <input type="hidden" name="agentId" value={agentId} />
                      <input type="hidden" name="sourceId" value={s.id} />
                      <button
                        type="submit"
                        aria-label={`Remover fonte ${s.title}`}
                        className="rounded-[var(--radius)] border border-ink/15 px-2.5 py-1.5 text-xs text-attn-critical transition-colors hover:bg-attn-bg"
                      >
                        🗑 Remover
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Adicionar conhecimento */}
          <section aria-label="Adicionar conhecimento" className="card-premium mt-6 p-6">
            <h2 className="font-display text-base font-semibold text-ink">
              <span className="blueprint-index mr-2 text-brand/70">03/</span>
              Adicionar conhecimento
            </h2>
            <p className="mb-4 text-xs text-ink-muted">
              Tudo é cifrado em repouso, auditado e aplicado <strong>ao vivo</strong> — a próxima
              contribuição já consulta o material novo. Guia de boas práticas:{' '}
              <code className="rounded bg-surface-muted px-1">docs/GUIA-CONHECIMENTO.md</code>.
            </p>
            <div className="grid gap-6 md:grid-cols-3">
              <div className="rounded-[var(--radius)] border border-ink/10 p-4">
                <AddTextForm agentId={agentId} />
              </div>
              <div className="rounded-[var(--radius)] border border-ink/10 p-4">
                <AddUrlForm agentId={agentId} />
              </div>
              <div className="rounded-[var(--radius)] border border-ink/10 p-4">
                <AddFileForm agentId={agentId} />
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
