/**
 * Utility for parsing agent strings with optional model specification.
 * Supports the colon syntax: "agent" or "agent:model"
 * Examples: "claude", "claude:opus", "gemini:flash"
 */
import { AI_AGENT } from 'rover-core';

export interface ParsedAgent {
  agent: AI_AGENT;
  model?: string;
}

/**
 * Parse an agent string with optional model specification.
 * Format: "agent" or "agent:model"
 *
 * @param agentString - The agent string to parse (e.g., "claude:opus")
 * @returns Parsed agent object with agent name and optional model
 * @throws Error if the agent name is invalid
 *
 * @example
 * parseAgentString("claude") // { agent: "claude", model: undefined }
 * parseAgentString("claude:opus") // { agent: "claude", model: "opus" }
 * parseAgentString("gemini:flash-2.0") // { agent: "gemini", model: "flash-2.0" }
 */
export function parseAgentString(agentString: string): ParsedAgent {
  const parts = agentString.split(':');
  const agentName = parts[0].toLowerCase();
  // Join remaining parts with ':' in case model name contains colons
  const model = parts.length > 1 ? parts.slice(1).join(':') : undefined;

  // Validate and normalize agent name
  let normalizedAgent: AI_AGENT;
  switch (agentName) {
    case 'claude':
      normalizedAgent = AI_AGENT.Claude;
      break;
    case 'codex':
      normalizedAgent = AI_AGENT.Codex;
      break;
    case 'cursor':
      normalizedAgent = AI_AGENT.Cursor;
      break;
    case 'gemini':
      normalizedAgent = AI_AGENT.Gemini;
      break;
    case 'qwen':
      normalizedAgent = AI_AGENT.Qwen;
      break;
    case 'opencode':
      normalizedAgent = AI_AGENT.OpenCode;
      break;
    default:
      throw new Error(
        `Invalid agent: ${agentName}. Valid options are: ${Object.values(AI_AGENT).join(', ')}`
      );
  }

  return {
    agent: normalizedAgent,
    model: model || undefined,
  };
}

/**
 * Format an agent with its model for display.
 *
 * @param agent - The AI agent
 * @param model - Optional model name
 * @returns Formatted string (e.g., "claude:opus" or "claude")
 */
export function formatAgentWithModel(agent: AI_AGENT, model?: string): string {
  return model ? `${agent}:${model}` : agent;
}
