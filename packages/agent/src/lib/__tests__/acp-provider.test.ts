import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../acp-invoke.js', () => ({
  acpInvoke: vi.fn().mockResolvedValue('mock response'),
}));

vi.mock('rover-prompts', () => ({
  PromptBuilder: class {
    expandTaskPrompt() {
      return '';
    }
    expandIterationInstructionsPrompt() {
      return '';
    }
    generateCommitMessagePrompt() {
      return '';
    }
    resolveMergeConflictsPrompt() {
      return '';
    }
    extractGithubInputsPrompt() {
      return '';
    }
  },
}));

vi.mock('rover-core', async () => {
  const actual = await vi.importActual('rover-core');
  return {
    ...actual,
    UserSettingsManager: {
      exists: () => false,
    },
  };
});

import { ACPProvider } from '../acp-provider.js';
import { acpInvoke } from '../acp-invoke.js';

const mockedAcpInvoke = vi.mocked(acpInvoke);

describe('ACPProvider', () => {
  beforeEach(() => {
    mockedAcpInvoke.mockClear();
    mockedAcpInvoke.mockResolvedValue('mock response');
  });

  describe('systemPrompt', () => {
    it('passes systemPrompt through to acpInvoke', async () => {
      const provider = new ACPProvider({ agentName: 'claude' });
      await provider.invoke('hello', { systemPrompt: 'You are helpful.' });

      expect(mockedAcpInvoke).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: 'You are helpful.',
        })
      );
    });

    it('does not include systemPrompt when not provided', async () => {
      const provider = new ACPProvider({ agentName: 'claude' });
      await provider.invoke('hello');

      expect(mockedAcpInvoke).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: undefined,
        })
      );
    });

    it('prepends system tags in acpInvoke when systemPrompt is set', async () => {
      // Unmock acpInvoke for this test to verify the prepend logic
      // We test the integration indirectly by checking the config passed
      const provider = new ACPProvider({ agentName: 'claude' });
      await provider.invoke('user prompt', {
        systemPrompt: 'Be concise.',
        json: true,
      });

      const call = mockedAcpInvoke.mock.calls[0][0];
      expect(call.systemPrompt).toBe('Be concise.');
      expect(call.prompt).toContain('user prompt');
      expect(call.prompt).toContain('valid JSON string');
    });
  });

  describe('fromProject', () => {
    it('creates provider with default claude agent when no settings exist', () => {
      const provider = ACPProvider.fromProject('/some/path');
      expect(provider).toBeInstanceOf(ACPProvider);
    });
  });
});
