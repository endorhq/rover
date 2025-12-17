import { describe, expect, it } from 'vitest';
import { GeminiAgent } from '../gemini.js';

describe('GeminiAgent.recoverFromError', () => {
  it('treats YOLO warnings as recoverable', async () => {
    const agent = new GeminiAgent();
    const recovery = await agent.recoverFromError({
      prompt: 'test',
      error: {
        stdout: Buffer.from(
          JSON.stringify({ response: { status: 'ok' } }),
          'utf-8'
        ),
        stderr:
          'YOLO mode is enabled. All tool calls will be automatically approved.',
      },
    });

    expect(recovery).not.toBeNull();
    expect(recovery?.rawOutput).toContain('status');
    expect(recovery?.notice).toContain('YOLO mode is enabled');
  });

  it('returns null when warning is absent', async () => {
    const agent = new GeminiAgent();
    const recovery = await agent.recoverFromError({
      prompt: 'test',
      error: {
        stdout: Buffer.from('{"response":"ok"}'),
        stderr: 'All good',
      },
    });

    expect(recovery).toBeNull();
  });
});
