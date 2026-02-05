import { Agent } from './types.js';
import { ClaudeAgent } from './claude.js';
import { CodexAgent } from './codex.js';
import { CursorAgent } from './cursor.js';
import { GeminiAgent } from './gemini.js';
import { OpenCodeAgent } from './opencode.js';
import { QwenAgent } from './qwen.js';
import { AI_AGENT } from 'rover-core';

export * from './types.js';
export { ClaudeAgent } from './claude.js';
export { CodexAgent } from './codex.js';
export { CursorAgent } from './cursor.js';
export { GeminiAgent } from './gemini.js';
export { OpenCodeAgent } from './opencode.js';
export { QwenAgent } from './qwen.js';

export function createAgent(
  agentName: string,
  version: string = 'latest',
  model?: string
): Agent {
  switch (agentName.toLowerCase()) {
    case 'claude':
      return new ClaudeAgent(version, model);
    case 'codex':
      return new CodexAgent(version, model);
    case 'cursor':
      return new CursorAgent(version, model);
    case 'gemini':
      return new GeminiAgent(version, model);
    case 'opencode':
      return new OpenCodeAgent(version, model);
    case 'qwen':
      return new QwenAgent(version, model);
    default:
      throw new Error(
        `Unknown agent: ${agentName}. Supported agents: ${Object.values(AI_AGENT).join(', ')}`
      );
  }
}

export function getSupportedAgents(): string[] {
  return Object.values(AI_AGENT);
}
