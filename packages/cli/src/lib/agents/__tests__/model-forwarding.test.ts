import { describe, expect, it, vi } from 'vitest';
import ClaudeAI from '../claude.js';
import CodexAI from '../codex.js';
import CopilotAI from '../copilot.js';
import CursorAI from '../cursor.js';
import GeminiAI from '../gemini.js';
import OpenCodeAI from '../opencode.js';
import QwenAI from '../qwen.js';

const AGENT_MODEL = 'test-model';

const agentFactories = [
  ['claude', () => new ClaudeAI(AGENT_MODEL)],
  ['codex', () => new CodexAI(AGENT_MODEL)],
  ['copilot', () => new CopilotAI(AGENT_MODEL)],
  ['cursor', () => new CursorAI(AGENT_MODEL)],
  ['gemini', () => new GeminiAI(AGENT_MODEL)],
  ['opencode', () => new OpenCodeAI(AGENT_MODEL)],
  ['qwen', () => new QwenAI(AGENT_MODEL)],
] as const;

describe('agent model forwarding', () => {
  it.each(
    agentFactories
  )('passes the configured model to resolveMergeConflicts for %s', async (_name, createAgent) => {
    const agent = createAgent();
    const invoke = vi.fn().mockResolvedValue('resolved');
    agent.invoke = invoke;

    await agent.resolveMergeConflicts('file.ts', 'diff', 'content');

    expect(invoke).toHaveBeenCalledWith(expect.any(String), {
      model: AGENT_MODEL,
    });
  });

  it.each(
    agentFactories
  )('passes the configured model to expandTask for %s', async (_name, createAgent) => {
    const agent = createAgent();
    const invoke = vi.fn().mockResolvedValue('{"title":"task","steps":[]}');
    agent.invoke = invoke;

    await agent.expandTask('brief', '/tmp/project', 'context');

    expect(invoke).toHaveBeenCalledWith(expect.any(String), {
      json: true,
      cwd: '/tmp/project',
      model: AGENT_MODEL,
    });
  });
});
