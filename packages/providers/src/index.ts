// Tipos de domínio dos contratos
export {
  ALL_AGENT_IDS,
  COUNSELOR_AGENT_IDS,
  DEFAULT_AGENT_IDS,
  DEFAULT_COUNSELOR_AGENT_IDS,
  PRESIDENT_AGENT_ID,
} from './types';
export type {
  AgentId,
  ContributionType,
  ContributionSeverity,
  VideoState,
  TranscriptSegment,
  KbChunk,
  AgentContribution,
  ClipRef,
} from './types';

// As 4 interfaces de abstração de fornecedores (NFR8)
export type {
  ISttProvider,
  SttSession,
  SttOpenOptions,
  ILlmProvider,
  LlmCompletionRequest,
  TextCompletionRequest,
  IKnowledgeRetriever,
  IVideoAssetProvider,
} from './interfaces';

// Fakes determinísticos (reutilizáveis por E2–E8)
export {
  FakeSttProvider,
  FakeLlmProvider,
  FakeTextCompleter,
  FakeKnowledgeRetriever,
  FakeVideoAssetProvider,
} from './fakes';

// Utilitário de parsing de saída de LLM (strip de cercas de código)
export { stripJsonFences } from './json';

// Vocabulário de negócio p/ boost do STT (keyterm/keywords)
export { BUSINESS_VOCABULARY } from './vocabulary';
