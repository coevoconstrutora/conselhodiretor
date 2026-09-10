import { describe, it, expect } from 'vitest';
import { generateSecretaryMinutes } from './reports';
import { FakeLlmProvider } from '@conselho/providers';
import type { ILlmProvider, LlmCompletionRequest, AgentContribution } from '@conselho/providers';

const COMPANY_ID = 'empresa-teste';

const REPORTS = [
  { agentId: 'cfo', content: '## Minha leitura da reunião\nRisco de caixa no Q3.' },
  { agentId: 'legal', content: '## Minha leitura da reunião\nContrato do terreno X aprovado.' },
  { agentId: 'presidente', content: '## Resumo executivo\nDecisão: seguir com o terreno X.' },
];

describe('generateSecretaryMinutes — ata da Secretária (Etapa "Secretária")', () => {
  it('gera a ata a partir da transcrição + relatórios, com o system prompt da Secretária', async () => {
    const llm = new FakeLlmProvider('secretaria', 'sintese');
    const finals = ['Vamos decidir sobre o terreno X.', 'Aprovado, seguimos com o terreno X.'];
    const minutes = await generateSecretaryMinutes(llm, COMPANY_ID, finals, REPORTS);
    expect(minutes).toContain('terreno X');
  });

  it('o system prompt restringe a Secretária a registrar, nunca opinar', async () => {
    let capturedSystem = '';
    const llm: ILlmProvider = {
      async complete(req: LlmCompletionRequest): Promise<AgentContribution> {
        capturedSystem = req.system;
        return { agentId: 'secretaria', type: 'sintese', severity: 'normal', text: 'Ata gerada.' };
      },
    };
    await generateSecretaryMinutes(llm, COMPANY_ID, ['fala 1'], REPORTS);
    expect(capturedSystem).toContain('Secretária do Conselho');
    expect(capturedSystem).toContain('Você NÃO é conselheira');
    expect(capturedSystem).toContain('## Decisões Tomadas');
    expect(capturedSystem).toContain('## Ações a Realizar');
  });

  it('lança quando o modelo não gera conteúdo (nunca salva ata vazia)', async () => {
    const llm: ILlmProvider = {
      async complete(): Promise<AgentContribution> {
        return { agentId: 'secretaria', type: 'sintese', severity: 'normal', text: '   ' };
      },
    };
    await expect(generateSecretaryMinutes(llm, COMPANY_ID, ['fala 1'], REPORTS)).rejects.toThrow(
      /ata da Secretária/,
    );
  });
});
