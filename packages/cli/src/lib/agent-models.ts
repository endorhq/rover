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
  // Copilot models from: https://docs.github.com/en/copilot/reference/ai-models/supported-models
  [AI_AGENT.Copilot]: [
    // OpenAI models
    {
      name: 'gpt-5.2-codex',
      description: 'Latest code-specialized model',
      isDefault: true,
    },
    { name: 'gpt-5.2', description: 'Latest general model' },
    { name: 'gpt-5.1-codex-max', description: 'High-capacity coding model' },
    { name: 'gpt-5.1-codex', description: 'Code-focused model' },
    { name: 'gpt-5.1-codex-mini', description: 'Lightweight coding model' },
    { name: 'gpt-5.1', description: 'Improved general model' },
    { name: 'gpt-5-mini', description: 'Efficient variant' },
    { name: 'gpt-4.1', description: 'General-purpose model' },
    // Anthropic Claude models
    { name: 'claude-opus-4.6', description: 'Latest high-performance Claude' },
    { name: 'claude-opus-4.5', description: 'Enhanced capability Claude' },
    { name: 'claude-sonnet-4.5', description: 'Balanced Claude variant' },
    { name: 'claude-sonnet-4', description: 'Balanced capability Claude' },
    { name: 'claude-haiku-4.5', description: 'Fast, efficient Claude' },
    // Google Gemini models
    { name: 'gemini-3-pro', description: 'Professional-grade Gemini' },
    { name: 'gemini-3-flash', description: 'Speed-optimized Gemini' },
    { name: 'gemini-2.5-pro', description: 'Advanced multimodal Gemini' },
    // Other providers
    { name: 'grok-code-fast-1', description: 'Speed-optimized coding (xAI)' },
    { name: 'raptor-mini', description: 'Fine-tuned GPT-5 mini variant' },
  ],
  [AI_AGENT.Gemini]: [
    {
      name: 'flash',
      description: 'Balance of speed and reasoning',
      isDefault: true,
    },
    { name: 'pro', description: 'Deep reasoning and creativity' },
    { name: 'flash-lite', description: 'Fast and lightweight' },
  ],
  [AI_AGENT.Qwen]: [
    {
      name: 'coder-model',
      description: 'Coding-optimized model',
      isDefault: true,
    },
  ],
  [AI_AGENT.Codex]: [
    {
      name: 'gpt-5.1-codex-max',
      description: 'Codex-optimized flagship for deep reasoning',
      isDefault: true,
    },
    { name: 'gpt-5.1-codex', description: 'Optimized for codex' },
    {
      name: 'gpt-5.1-codex-mini',
      description: 'Faster and cheaper codex model',
    },
    { name: 'gpt-5.2', description: 'Latest frontier model' },
    { name: 'gpt-5.1', description: 'Strong general reasoning' },
  ],
  [AI_AGENT.Cursor]: [
    { name: 'auto', description: 'Automatic model selection', isDefault: true },
    { name: 'sonnet-4.5', description: 'Claude 4.5 Sonnet' },
    {
      name: 'sonnet-4.5-thinking',
      description: 'Claude 4.5 Sonnet (Thinking)',
    },
    { name: 'opus-4.5', description: 'Claude 4.5 Opus' },
    { name: 'opus-4.5-thinking', description: 'Claude 4.5 Opus (Thinking)' },
    { name: 'opus-4.1', description: 'Claude 4.1 Opus' },
    { name: 'gemini-3-pro', description: 'Gemini 3 Pro' },
    { name: 'gemini-3-flash', description: 'Gemini 3 Flash' },
    { name: 'gpt-5.2', description: 'GPT-5.2' },
    { name: 'gpt-5.1', description: 'GPT-5.1' },
    { name: 'grok', description: 'Grok' },
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
