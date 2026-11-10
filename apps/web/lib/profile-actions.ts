'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { changeUserPassword, MIN_PASSWORD_LENGTH } from '@conselho/auth';
import { getCurrentUser, SESSION_COOKIE } from './auth';
import { getDb } from './db';
import { ensureParticipantForUser, updateOwnParticipantProfile } from './participants';

/**
 * "Meu perfil" — autoatendimento de QUALQUER usuário autenticado (inclusive
 * convidado): só mexe na PRÓPRIA conta, nunca recebe userId do cliente.
 */

export type ProfileActionState = { error?: string; ok?: string } | null;

const NAME_MAX = 120;

/** Nome de exibição (conta) + cargo/área (participante vinculado, usado na voz/ata). */
export async function updateProfileAction(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };

  const displayName = String(formData.get('displayName') ?? '').trim();
  const jobTitle = String(formData.get('jobTitle') ?? '').trim() || null;
  const department = String(formData.get('department') ?? '').trim() || null;
  if (displayName.length < 2) return { error: 'Informe seu nome (mínimo 2 caracteres).' };
  if (displayName.length > NAME_MAX) return { error: `O nome pode ter no máximo ${NAME_MAX} caracteres.` };

  try {
    const db = await getDb();
    await db.query('UPDATE app_user SET display_name = $2, updated_at = now() WHERE id = $1', [
      user.id,
      displayName,
    ]);
    const participant = await ensureParticipantForUser(db, user.companyId, {
      id: user.id,
      email: user.email,
      displayName,
    });
    await updateOwnParticipantProfile(db, user.companyId, participant.id, {
      name: displayName,
      jobTitle,
      department,
    });
    revalidatePath('/', 'layout');
    return { ok: 'Perfil atualizado.' };
  } catch (err) {
    console.error('[perfil] atualizar falhou:', err);
    return { error: 'Falha inesperada ao salvar o perfil — tente de novo.' };
  }
}

/** Cria/vincula o participante da própria conta — pré-requisito para cadastrar a voz. */
export async function enableOwnParticipantAction(
  _prev: ProfileActionState,
): Promise<ProfileActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };
  try {
    const db = await getDb();
    await ensureParticipantForUser(db, user.companyId, {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    });
    revalidatePath('/profile');
    return { ok: 'Perfil de participante pronto.' };
  } catch (err) {
    console.error('[perfil] vincular participante falhou:', err);
    return { error: 'Falha inesperada — tente de novo.' };
  }
}

const PASSWORD_ERRORS = {
  wrong_current: 'A senha atual está incorreta.',
  too_short: `A nova senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`,
  same_as_current: 'A nova senha precisa ser diferente da atual.',
  no_password_set: 'Esta conta não tem senha definida — use "Esqueci minha senha" na tela de login.',
  user_not_found: 'Usuário não encontrado.',
} as const;

/**
 * Troca de senha: exige a senha atual, mantém ESTA sessão e encerra as demais
 * (outros navegadores/dispositivos). A senha é da pessoa — vale em todas as
 * empresas a que ela tem acesso.
 */
export async function changePasswordAction(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sessão expirada — faça login novamente.' };

  const currentPassword = String(formData.get('currentPassword') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');
  if (!currentPassword || !newPassword) return { error: 'Preencha a senha atual e a nova senha.' };
  if (newPassword !== confirmPassword) return { error: 'A confirmação não confere com a nova senha.' };

  try {
    const db = await getDb();
    const keepToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
    const result = await changeUserPassword(db, {
      userId: user.id,
      currentPassword,
      newPassword,
      keepSessionToken: keepToken,
    });
    if (!result.ok) return { error: PASSWORD_ERRORS[result.reason] };
    return { ok: 'Senha alterada. Os outros dispositivos conectados foram desconectados.' };
  } catch (err) {
    console.error('[perfil] trocar senha falhou:', err);
    return { error: 'Falha inesperada ao trocar a senha — tente de novo.' };
  }
}
