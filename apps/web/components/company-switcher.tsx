import { listCompanies } from '@/lib/company-actions';
import { listMyCompanies } from '@/lib/auth';
import { CompanySwitcherSelect } from './company-switcher-select';

/**
 * Seletor de empresa (server component: busca a lista). Super-admin vê
 * TODAS as empresas; usuário comum só vê as que ele é membro (só aparece
 * quando há mais de uma — checado dentro de CompanySwitcherSelect).
 */
export async function CompanySwitcher({
  userId,
  isSuperAdmin,
  currentCompanyId,
}: {
  userId: string;
  isSuperAdmin: boolean;
  currentCompanyId: string;
}) {
  const companies = isSuperAdmin ? await listCompanies() : await listMyCompanies(userId);
  return <CompanySwitcherSelect companies={companies} currentCompanyId={currentCompanyId} />;
}
