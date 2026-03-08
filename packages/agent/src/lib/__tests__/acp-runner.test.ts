import { describe, expect, it, vi } from 'vitest';
import { ACPRunner } from '../acp-runner.js';
import type { WorkflowManager } from 'rover-core';
import type { WorkflowAgentStep, WorkflowLoopStep } from 'rover-schemas';

describe('ACPRunner', () => {
  it('reports progress using nested agent step order', async () => {
    const topLevelStep: WorkflowAgentStep = {
      id: 'plan',
      type: 'agent',
      name: 'Plan',
      prompt: 'Plan the work',
      outputs: [],
    };
    const nestedStep: WorkflowAgentStep = {
      id: 'fix_code',
      type: 'agent',
      name: 'Fix Code',
      prompt: 'Fix the code',
      outputs: [],
    };
    const loopStep: WorkflowLoopStep = {
      id: 'review_loop',
      type: 'loop',
      name: 'Review Loop',
      until: 'steps.fix_code.outputs.done == true',
      steps: [nestedStep],
    };

    const workflow = {
      steps: [topLevelStep, loopStep],
      defaults: { tool: 'claude', model: 'sonnet' },
      getStep: vi.fn((stepId: string) => {
        if (stepId === topLevelStep.id) return topLevelStep;
        if (stepId === nestedStep.id) return nestedStep;
        if (stepId === loopStep.id) return loopStep;
        throw new Error(`Unknown step: ${stepId}`);
      }),
      getStepModel: vi.fn().mockReturnValue(undefined),
      findStep: vi.fn((stepId: string) => {
        if (stepId === topLevelStep.id) return topLevelStep;
        if (stepId === nestedStep.id) return nestedStep;
        if (stepId === loopStep.id) return loopStep;
        return undefined;
      }),
    } as unknown as WorkflowManager;

    const statusManager = {
      update: vi.fn(),
    } as any;

    const runner = new ACPRunner({
      workflow,
      inputs: new Map(),
      statusManager,
      defaultTool: 'claude',
    });

    (runner as any).isConnectionInitialized = true;
    (runner as any).isSessionCreated = true;
    (runner as any).sessionId = 'session-1';
    (runner as any).connection = {};
    (runner as any).sendPrompt = vi.fn().mockResolvedValue({
      stopReason: 'end_turn',
      response: '{}',
      tokens: 12,
      cost: 0,
    });

    const result = await runner.runStep('fix_code');

    expect(result.success).toBe(true);
    expect(statusManager.update).toHaveBeenNthCalledWith(
      1,
      'running',
      'Fix Code',
      50
    );
    expect(statusManager.update).toHaveBeenNthCalledWith(
      2,
      'running',
      'Fix Code',
      100
    );
  });
});
