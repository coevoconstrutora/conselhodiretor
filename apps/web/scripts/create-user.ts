/**
 * Cria (ou atualiza) o usuário DONO do sistema — CLI de setup.
 *
 * Uso (da raiz do repositório):
 *   pnpm create-user -- --email voce@suaempresa.com.br --nome "Seu Nome" --senha "SuaSenhaForte"
 *
 * Opções:
 *   --email   obrigatório — e-mail de login
 *   --nome    obrigatório — nome exibido no painel
 *   --senha   obrigatório — mínimo 8 caracteres
 *   --desativar-demo  opcional — troca a senha do usuário demo por uma aleatória
 *                     (o login demo@conselho.test deixa de funcionar)
 *   --role    opcional — admin | gestor | convidado (default: admin — este CLI
 *             é o bootstrap do dono; usuários adicionais normalmente entram
 *             pela tela de gestão de usuários, não por aqui)
 *   --empresa opcional — slug da empresa (default: coevo — cria se não existir)
 *   --super-admin opcional — marca `is_super_admin` (acesso a TODAS as
 *             empresas, ex.: /admin/companies) — normalmente só concedido
 *             pela tela de gestão de super-admins; este flag é atalho de dev.
 *
 * Banco: usa DATABASE_URL se definido (produção/Postgres), senão o PGlite local
 * de desenvolvimento (apps/web/.pgdata) — o MESMO banco que o `pnpm dev` usa.
 * Se o e-mail já existir, atualiza nome e senha (serve para trocar a senha).
 *
 * ⚠️ Em dev local (PGlite): rode com o `pnpm dev` PARADO — o PGlite é
 * single-process e o servidor não enxerga escritas feitas por outro processo
 * até reiniciar. Com DATABASE_URL (Postgres real) não há essa restrição.
 */
import { randomBytes } from 'node:crypto';
import { hashPassword } from '@conselho/auth';
import { runMigrations, type SqlExecutor } from '@conselho/db';

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function fail(message: string): never {
  console.error(`\n❌ ${message}\n`);
  console.error(
    'Uso: pnpm create-user -- --email voce@empresa.com --nome "Seu Nome" --senha "SuaSenhaForte" [--desativar-demo]',
  );
  process.exit(1);
}

async function openDb(): Promise<{ db: SqlExecutor; label: string; close: () => Promise<void> }> {
  if (process.env.DATABASE_URL) {
    const { createPool, pgExecutor } = await import('@conselho/db');
    const pool = createPool();
    return {
      db: pgExecutor(pool),
      label: 'Postgres (DATABASE_URL)',
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const pglite = new PGlite('./.pgdata');
  const { pgliteExecutor } = await import('@conselho/db');
  return {
    db: pgliteExecutor(pglite),
    label: 'PGlite local (apps/web/.pgdata)',
    close: () => pglite.close(),
  };
}

async function main(): Promise<void> {
  const email = argValue('--email')?.trim().toLowerCase();
  const nome = argValue('--nome')?.trim();
  const senha = argValue('--senha');
  const desativarDemo = process.argv.includes('--desativar-demo');
  const superAdmin = process.argv.includes('--super-admin');
  const role = argValue('--role') ?? 'admin';
  const empresaSlug = argValue('--empresa')?.trim().toLowerCase() || 'coevo';

  if (!email || !email.includes('@')) fail('Informe um e-mail válido em --email.');
  if (!nome) fail('Informe o nome em --nome.');
  if (!senha || senha.length < 8) fail('Informe uma senha com pelo menos 8 caracteres em --senha.');
  if (!['admin', 'gestor', 'convidado'].includes(role)) {
    fail('--role deve ser admin, gestor ou convidado.');
  }

  const { db, label, close } = await openDb();
  try {
    console.log(`\n🔌 Banco: ${label}`);
    await runMigrations(db);

    let companyRes = await db.query<{ id: string }>('SELECT id FROM company WHERE slug = $1', [
      empresaSlug,
    ]);
    if (companyRes.rows.length === 0) {
      companyRes = await db.query<{ id: string }>(
        'INSERT INTO company (slug, name) VALUES ($1, $2) RETURNING id',
        [empresaSlug, empresaSlug],
      );
      console.log(`🏢 Empresa "${empresaSlug}" criada.`);
    }
    const companyId = companyRes.rows[0]!.id;

    const passwordHash = hashPassword(senha);
    const existing = await db.query<{ id: string }>('SELECT id FROM app_user WHERE email = $1', [
      email,
    ]);
    if (existing.rows.length > 0) {
      await db.query(
        'UPDATE app_user SET display_name = $2, password_hash = $3, role = $4, is_super_admin = is_super_admin OR $5, updated_at = now() WHERE email = $1',
        [email, nome, passwordHash, role, superAdmin],
      );
      console.log(`✅ Usuário ${email} já existia — nome, senha e papel (${role}) ATUALIZADOS.`);
    } else {
      await db.query(
        'INSERT INTO app_user (email, display_name, password_hash, role, company_id, is_super_admin) VALUES ($1, $2, $3, $4, $5, $6)',
        [email, nome, passwordHash, role, companyId, superAdmin],
      );
      console.log(`✅ Usuário ${email} criado (papel: ${role}, empresa: ${empresaSlug}).`);
    }
    if (superAdmin) console.log('👑 Super-admin concedido (acesso a todas as empresas).');

    if (desativarDemo) {
      const randomPass = hashPassword(randomBytes(24).toString('base64url'));
      const res = await db.query<{ id: string }>(
        `UPDATE app_user SET password_hash = $1, updated_at = now()
         WHERE email = 'demo@conselho.test' RETURNING id`,
        [randomPass],
      );
      console.log(
        res.rows.length > 0
          ? '🔒 Usuário demo desativado (senha trocada por uma aleatória).'
          : 'ℹ️ Usuário demo não existe neste banco — nada a desativar.',
      );
    }

    console.log('\n🎉 Pronto! Faça login em http://localhost:3000 com o seu e-mail e senha.\n');
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error('\n❌ Falha ao criar usuário:', error instanceof Error ? error.message : error);
  process.exit(1);
});
