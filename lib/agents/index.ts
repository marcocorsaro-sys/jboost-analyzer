export type {
  Agent,
  AgentExecutionContext,
  AgentLoopOptions,
  AgentLoopOutcome,
  AgentRunResult,
  QualityLoopHistoryEntry,
  QualityVerdict,
  QualityVerdictKind,
  TokenUsage,
} from './types';

export { assessQuality } from './quality-agent';
export type { QualityJudgeInput } from './quality-agent';
export { runAgentWithQuality } from './run-with-quality';

// 9 driver agents.
export { aiRelevanceAgent, AI_RELEVANCE_METHODOLOGY } from './drivers/ai-relevance-agent';
export type { AiRelevanceInput, AiRelevanceOutput } from './drivers/ai-relevance-agent';
export { complianceAgent, COMPLIANCE_METHODOLOGY } from './drivers/compliance-agent';
export type { ComplianceInput, ComplianceOutput } from './drivers/compliance-agent';
export { experienceAgent, EXPERIENCE_METHODOLOGY } from './drivers/experience-agent';
export type { ExperienceInput, ExperienceOutput } from './drivers/experience-agent';
export { discoverabilityAgent, DISCOVERABILITY_METHODOLOGY } from './drivers/discoverability-agent';
export type { DiscoverabilityInput, DiscoverabilityOutput } from './drivers/discoverability-agent';
export { contentAgent, CONTENT_METHODOLOGY } from './drivers/content-agent';
export type { ContentInput, ContentOutput } from './drivers/content-agent';
export { accessibilityAgent, ACCESSIBILITY_METHODOLOGY } from './drivers/accessibility-agent';
export type { AccessibilityInput, AccessibilityOutput } from './drivers/accessibility-agent';
export { authorityAgent, AUTHORITY_METHODOLOGY } from './drivers/authority-agent';
export type { AuthorityInput, AuthorityOutput } from './drivers/authority-agent';
export { asoVisibilityAgent, ASO_VISIBILITY_METHODOLOGY } from './drivers/aso-visibility-agent';
export type { AsoVisibilityInput, AsoVisibilityOutput } from './drivers/aso-visibility-agent';
export { awarenessAgent, AWARENESS_METHODOLOGY } from './drivers/awareness-agent';
export type { AwarenessInput, AwarenessOutput } from './drivers/awareness-agent';

// MarTech as 10th agent (separate domain).
export { martechAgent, MARTECH_METHODOLOGY } from './martech-agent';
export type { MartechInput, MartechOutput } from './martech-agent';

// Driver registry — used by the orchestrator to iterate all 9 drivers.
import { aiRelevanceAgent } from './drivers/ai-relevance-agent';
import { complianceAgent } from './drivers/compliance-agent';
import { experienceAgent } from './drivers/experience-agent';
import { discoverabilityAgent } from './drivers/discoverability-agent';
import { contentAgent } from './drivers/content-agent';
import { accessibilityAgent } from './drivers/accessibility-agent';
import { authorityAgent } from './drivers/authority-agent';
import { asoVisibilityAgent } from './drivers/aso-visibility-agent';
import { awarenessAgent } from './drivers/awareness-agent';
import type { Agent } from './types';

// Type any[] because each agent has its own narrow Input/Output pair.
// The orchestrator builds the right input per agent.name and routes the
// output back generically — see run-analysis.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DRIVER_AGENTS: ReadonlyArray<Agent<any, any>> = [
  complianceAgent,
  experienceAgent,
  discoverabilityAgent,
  contentAgent,
  accessibilityAgent,
  authorityAgent,
  asoVisibilityAgent,
  aiRelevanceAgent,
  awarenessAgent,
];
