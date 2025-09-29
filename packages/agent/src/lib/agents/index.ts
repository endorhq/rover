import { Agent } from './types.js';
import { ClaudeAgent } from './claude.js';
import { CodexAgent } from './codex.js';
import { GeminiAgent } from './gemini.js';
import { QwenAgent } from './qwen.js';

export * from './types.js';
export { ClaudeAgent } from './claude.js';
export { CodexAgent } from './codex.js';
export { GeminiAgent } from './gemini.js';
export { QwenAgent } from './qwen.js';

export function createAgent(
  agentName: string,
  version: string = 'latest'
): Agent {
  switch (agentName.toLowerCase()) {
    case 'claude':
      return new ClaudeAgent(version);
    case 'codex':
      return new CodexAgent(version);
    case 'gemini':
      return new GeminiAgent(version);
    case 'qwen':
      return new QwenAgent(version);
    default:
      throw new Error(
        `Unknown agent: ${agentName}. Supported agents: claude, codex, gemini, qwen`
      );
  }
}

export function getSupportedAgents(): string[] {
  return ['claude', 'codex', 'gemini', 'qwen'];
}
