import { listCompanies } from '@/lib/company-actions';
import { CompanySwitcherSelect } from './company-switcher-select';

/** Seletor de empresa (server component: busca a lista) — só pra super-admin. */
export async function CompanySwitcher({ currentCompanyId }: { currentCompanyId: string }) {
  const companies = await listCompanies();
  return <CompanySwitcherSelect companies={companies} currentCompanyId={currentCompanyId} />;
}
