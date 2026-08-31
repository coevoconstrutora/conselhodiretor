import 'server-only';

/**
 * Consulta pública de CNPJ (BrasilAPI — espelha a base da Receita Federal,
 * sem chave/custo). Usado só para PRÉ-PREENCHER o perfil da empresa — o
 * usuário sempre revisa e confirma antes de salvar.
 */

export interface CnpjData {
  readonly razaoSocial: string;
  readonly nomeFantasia: string | null;
  readonly segmento: string | null;
  readonly regiao: string | null;
}

export class CnpjLookupError extends Error {}

export async function lookupCnpj(rawCnpj: string): Promise<CnpjData> {
  const cnpj = rawCnpj.replace(/\D/g, '');
  if (cnpj.length !== 14) throw new CnpjLookupError('CNPJ inválido — deve ter 14 dígitos.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      signal: controller.signal,
      headers: { 'user-agent': 'ConselhoCompanyProfile/1.0' },
    });
  } catch (err) {
    throw new CnpjLookupError(
      `Não foi possível consultar o CNPJ: ${err instanceof Error && err.name === 'AbortError' ? 'tempo esgotado' : 'falha de rede'}.`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 404) throw new CnpjLookupError('CNPJ não encontrado na base da Receita.');
  if (!response.ok) throw new CnpjLookupError(`Consulta falhou (HTTP ${response.status}).`);

  const data = (await response.json()) as {
    razao_social?: string;
    nome_fantasia?: string | null;
    cnae_fiscal_descricao?: string | null;
    municipio?: string | null;
    uf?: string | null;
  };
  if (!data.razao_social) throw new CnpjLookupError('Resposta da Receita sem razão social.');

  return {
    razaoSocial: data.razao_social,
    nomeFantasia: data.nome_fantasia?.trim() || null,
    segmento: data.cnae_fiscal_descricao?.trim() || null,
    regiao: data.municipio && data.uf ? `${data.municipio}/${data.uf}` : null,
  };
}
