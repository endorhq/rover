/**
 * Model definitions for each AI agent.
 * Used for model selection in init and CLI help text.
 */
import { AI_AGENT } from 'rover-core';

export interface AgentModelConfig {
  /** Model identifier (e.g., "opus", "sonnet", "flash") */
  name: string;
  /** Human-readable description */
  description: string;
  /** Whether this is the default model for the agent */
  isDefault?: boolean;
}

/**
 * Available models for each AI agent.
 * Models are listed in order of preference (default first).
 */
export const AGENT_MODELS: Record<AI_AGENT, AgentModelConfig[]> = {
  [AI_AGENT.Claude]: [
    {
      name: 'sonnet',
      description: 'Balanced performance and cost',
      isDefault: true,
    },
    { name: 'opus', description: 'Highest capability' },
    { name: 'haiku', description: 'Fastest and cheapest' },
  ],
  [AI_AGENT.Gemini]: [
    { name: 'flash', description: 'Fast and efficient', isDefault: true },
    { name: 'pro', description: 'Highest capability' },
  ],
  [AI_AGENT.Qwen]: [
    { name: 'plus', description: 'General purpose', isDefault: true },
    { name: 'qwq', description: 'Reasoning model' },
  ],
  [AI_AGENT.Codex]: [
    { name: 'o3', description: 'OpenAI o3 reasoning model', isDefault: true },
    { name: 'o4-mini', description: 'OpenAI o4-mini' },
    { name: 'gpt-4.1', description: 'GPT-4.1' },
  ],
  [AI_AGENT.Cursor]: [
    { name: 'sonnet-4', description: 'Claude Sonnet 4', isDefault: true },
    { name: 'sonnet-4-thinking', description: 'Claude Sonnet 4 with thinking' },
    { name: 'gpt-5', description: 'GPT-5' },
  ],
};

/**
 * Get available models for a specific agent.
 */
export function getAvailableModels(agent: AI_AGENT): AgentModelConfig[] {
  return AGENT_MODELS[agent] || [];
}

/**
 * Get the default model name for a specific agent.
 */
export function getDefaultModelName(agent: AI_AGENT): string | undefined {
  const models = AGENT_MODELS[agent];
  return models?.find(m => m.isDefault)?.name;
}

/**
 * Check if an agent has multiple model options.
 * Used to determine whether to show model selection in init.
 */
export function hasMultipleModels(agent: AI_AGENT): boolean {
  return (AGENT_MODELS[agent]?.length || 0) > 1;
}

/**
 * Get agents that have multiple model options.
 */
export function getAgentsWithMultipleModels(): AI_AGENT[] {
  return Object.entries(AGENT_MODELS)
    .filter(([, models]) => models.length > 1)
    .map(([agent]) => agent as AI_AGENT);
}
