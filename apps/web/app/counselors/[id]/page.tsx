import { notFound } from 'next/navigation';
import { getAgentProfiles } from '@conselho/kb';
import type { AgentId } from '@conselho/providers';
import { requireCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import {
  listKbSources,
  loadAndApplyProfileOverrides,
  rescanDueUrlSources,
  rebuildAgentKnowledge,
  loadScopeSplit,
} from '@/lib/kb-sources';
import { getCompanyKnowledgeStore } from '@/lib/board-runtime';
import { deleteSourceAction } from '@/lib/counselor-actions';
import { getAgentEmoji } from '@/lib/agent-display';
import { AgentIcon } from '@/lib/agent-icons';
import { formatDateBR } from '@/lib/format';
import { ProfileForm, AddTextForm, AddUrlForm, AddFileForm } from '@/components/counselor-manager';
import { DashboardShell } from '@/components/dashboard-shell';

const KIND_LABEL: Record<string, string> = {
  text: '📄 texto',
  url: '🔗 link',
  file: '📎 arquivo',
};

/** "NotebookLM do conselheiro": perfil editável + fontes de conhecimento. */
export default async function CounselorPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCurrentUser();

  const { id } = await params;
  const db = await getDb();
  // perfis personalizados (incl. conselheiros CUSTOM) aplicados antes de ler
  // (boot pode ter sido de outro processo) — a lista real é o banco, não um
  // array fixo no código: um conselheiro custom não está em ALL_AGENT_IDS.
  await loadAndApplyProfileOverrides(db, user.companyId);
  const profile = getAgentProfiles(user.companyId)[id];
  if (!profile) notFound();
  const agentId = id as AgentId;
  const isPresident = agentId === 'presidente';
  const sources = isPresident ? [] : await listKbSources(db, user.companyId, agentId, getEncryptionKey());
  const totalChars = sources.reduce((acc, s) => acc + s.chars, 0);
  const { scopeCan, scopeCannot } = await loadScopeSplit(db, user.companyId, agentId);

  // Revisão automática de fontes por LINK vencidas — não bloqueia o render
  // (best-effort; processo fica de pé no Fly Machine, então isso completa
  // em background mesmo depois da resposta ir pro navegador).
  if (!isPresident) {
    void (async () => {
      try {
        const key = getEncryptionKey();
        const { rescanned } = await rescanDueUrlSources(db, user.companyId, agentId, key);
        if (rescanned > 0) {
          const kb = await getCompanyKnowledgeStore(user.companyId);
          await rebuildAgentKnowledge(kb, db, user.companyId, agentId, key);
        }
      } catch (err) {
        console.error(`[kb] revisão automática (${agentId}) falhou:`, err);
      }
    })();
  }

  return (
    <DashboardShell pageTitle={profile.displayName}>
      <div className="mt-2 flex items-center gap-2">
        <AgentIcon
          iconKey={profile.iconKey}
          iconColor={profile.iconColor}
          emoji={getAgentEmoji(agentId)}
          className="text-2xl"
        />
        {profile.professionalProfile ? (
          <p className="text-sm italic text-ink-muted">{profile.professionalProfile}</p>
        ) : null}
      </div>

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
        <ProfileForm
          agentId={agentId}
          displayName={profile.displayName}
          scopeCan={scopeCan}
          scopeCannot={scopeCannot}
          iconKey={profile.iconKey ?? null}
          iconColor={profile.iconColor ?? null}
          professionalProfile={profile.professionalProfile ?? null}
          decisionCriteria={profile.decisionCriteria ?? null}
          riskPosture={profile.riskPosture ?? null}
          riskPostureNotes={profile.riskPostureNotes ?? null}
        />
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
                        chars · {formatDateBR(s.createdAt)}
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
                        {s.kind === 'url' && s.rescanDays ? (
                          <>
                            {' · '}
                            <span className="text-brand/80">
                              🔄 a cada {s.rescanDays}d
                              {s.lastScannedAt
                                ? ` (última: ${formatDateBR(s.lastScannedAt)})`
                                : ''}
                            </span>
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
    </DashboardShell>
  );
}
