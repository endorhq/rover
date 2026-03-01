import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock rover-core before importing anything that uses it
vi.mock('rover-core', async () => {
  const actual =
    await vi.importActual<typeof import('rover-core')>('rover-core');
  return {
    ...actual,
    launch: vi.fn(),
    launchSync: vi.fn(),
    VERBOSE: false,
  };
});

// Mock the runner to avoid spawning real processes
vi.mock('../runner.js', () => ({
  Runner: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      id: 'mock_agent',
      success: true,
      duration: 1.0,
      outputs: new Map([['result', 'done']]),
    }),
    tool: 'claude',
  })),
}));

import {
  executeStep,
  shouldSkipStep,
  isTransientError,
  PauseWorkflowError,
} from '../step-executor.js';
import type { WorkflowManager } from 'rover-core';
import type { ACPRunner } from '../acp-runner.js';
import type {
  WorkflowAgentStep,
  WorkflowCommandStep,
  WorkflowLoopStep,
} from 'rover-schemas';

function createMockWorkflowManager(): WorkflowManager {
  return {
    getStepTimeout: vi.fn().mockReturnValue(300),
    getStepRetries: vi.fn().mockReturnValue(0),
    getStep: vi.fn(),
    findStep: vi.fn().mockReturnValue(undefined),
    getStepTool: vi.fn().mockReturnValue('claude'),
    getStepModel: vi.fn().mockReturnValue('sonnet'),
    defaults: { tool: 'claude', model: 'sonnet' },
    config: { timeout: 3600, continueOnError: false },
    steps: [],
  } as unknown as WorkflowManager;
}

describe('executeStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches agent steps to Runner', async () => {
    const agentStep: WorkflowAgentStep = {
      id: 'test_agent',
      name: 'Test Agent',
      type: 'agent',
      prompt: 'Do something',
      outputs: [],
    };

    const result = await executeStep(agentStep, {
      workflow: createMockWorkflowManager(),
      inputs: new Map(),
      stepsOutput: new Map(),
      totalSteps: 1,
      currentStepIndex: 0,
    });

    expect(result.id).toBe('mock_agent');
    expect(result.success).toBe(true);
  });

  it('uses acpRunner for agent steps when provided', async () => {
    const { Runner } = await import('../runner.js');

    const agentStep: WorkflowAgentStep = {
      id: 'acp_agent',
      name: 'ACP Agent',
      type: 'agent',
      prompt: 'Do something via ACP',
      outputs: [],
    };

    const mockResult = {
      id: 'acp_agent',
      success: true,
      duration: 0.5,
      outputs: new Map([['result', 'acp_done']]),
    };

    const mockAcpRunner = {
      createSession: vi.fn().mockResolvedValue('session-123'),
      runStep: vi.fn().mockResolvedValue(mockResult),
      closeSession: vi.fn(),
      stepsOutput: new Map<string, Map<string, string>>(),
    } as unknown as ACPRunner;

    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('prev_step', new Map([['key', 'value']]));

    const result = await executeStep(agentStep, {
      workflow: createMockWorkflowManager(),
      inputs: new Map(),
      stepsOutput,
      totalSteps: 1,
      currentStepIndex: 0,
      acpRunner: mockAcpRunner,
    });

    expect(mockAcpRunner.createSession).toHaveBeenCalledOnce();
    expect(mockAcpRunner.runStep).toHaveBeenCalledWith('acp_agent');
    expect(mockAcpRunner.closeSession).toHaveBeenCalledOnce();
    // stepsOutput should have been synced into acpRunner
    expect(mockAcpRunner.stepsOutput.get('prev_step')).toEqual(
      new Map([['key', 'value']])
    );
    expect(result).toEqual(mockResult);
    // Runner should NOT have been instantiated
    expect(Runner).not.toHaveBeenCalled();
  });

  it('closes acpRunner session even when runStep fails', async () => {
    const agentStep: WorkflowAgentStep = {
      id: 'fail_agent',
      name: 'Fail Agent',
      type: 'agent',
      prompt: 'This will fail',
      outputs: [],
    };

    const mockAcpRunner = {
      createSession: vi.fn().mockResolvedValue('session-456'),
      runStep: vi.fn().mockRejectedValue(new Error('ACP prompt failed')),
      closeSession: vi.fn(),
      stepsOutput: new Map<string, Map<string, string>>(),
    } as unknown as ACPRunner;

    await expect(
      executeStep(agentStep, {
        workflow: createMockWorkflowManager(),
        inputs: new Map(),
        stepsOutput: new Map(),
        totalSteps: 1,
        currentStepIndex: 0,
        acpRunner: mockAcpRunner,
      })
    ).rejects.toThrow('ACP prompt failed');

    // closeSession should still be called via finally
    expect(mockAcpRunner.closeSession).toHaveBeenCalledOnce();
  });

  it('dispatches command steps to runCommandStep', async () => {
    const { launch } = await import('rover-core');
    vi.mocked(launch).mockResolvedValue({
      exitCode: 0,
      stdout: 'all tests pass',
      stderr: '',
    } as any);

    const commandStep: WorkflowCommandStep = {
      id: 'run_tests',
      name: 'Run Tests',
      type: 'command',
      command: 'npm test',
    };

    const result = await executeStep(commandStep, {
      workflow: createMockWorkflowManager(),
      inputs: new Map(),
      stepsOutput: new Map(),
      totalSteps: 1,
      currentStepIndex: 0,
    });

    expect(result.id).toBe('run_tests');
    expect(result.success).toBe(true);
    expect(result.outputs.get('exit_code')).toBe('0');
    expect(result.outputs.get('stdout')).toBe('all tests pass');
  });

  it('dispatches loop steps and iterates until condition met', async () => {
    const { launch } = await import('rover-core');

    // First call: tests fail (exit code 1), second call: tests pass (exit code 0)
    let callCount = 0;
    vi.mocked(launch).mockImplementation((() => {
      callCount++;
      if (callCount <= 1) {
        return Promise.resolve({
          exitCode: 1,
          stdout: 'FAIL',
          stderr: 'test error',
        });
      }
      return Promise.resolve({ exitCode: 0, stdout: 'PASS', stderr: '' });
    }) as any);

    const loopStep: WorkflowLoopStep = {
      id: 'test_loop',
      name: 'Test Loop',
      type: 'loop',
      until: 'steps.run_tests.outputs.exit_code == 0',
      maxIterations: 3,
      steps: [
        {
          id: 'run_tests',
          name: 'Run Tests',
          type: 'command',
          command: 'npm test',
        } as WorkflowCommandStep,
        {
          id: 'fix_agent',
          name: 'Fix',
          type: 'agent',
          prompt: 'Fix: {{steps.run_tests.outputs.stderr}}',
          outputs: [],
        } as WorkflowAgentStep,
      ],
    };

    const stepsOutput = new Map<string, Map<string, string>>();

    const result = await executeStep(loopStep, {
      workflow: createMockWorkflowManager(),
      inputs: new Map(),
      stepsOutput,
      totalSteps: 1,
      currentStepIndex: 0,
    });

    expect(result.id).toBe('test_loop');
    expect(result.success).toBe(true);
    expect(result.outputs.get('condition_met')).toBe('true');
    // Condition is checked at the end of each iteration (after all sub-steps).
    // Iteration 1: run_tests fails → fix_agent runs → condition not met.
    // Iteration 2: run_tests passes → fix_agent runs → condition met.
    const iterations = Number.parseInt(result.outputs.get('iterations') || '0');
    expect(iterations).toBe(2);
  });

  it('loop agent sub-steps use acpRunner when provided', async () => {
    const { launch } = await import('rover-core');
    const { Runner } = await import('../runner.js');

    // Command sub-step fails first, then passes on second iteration
    let callCount = 0;
    vi.mocked(launch).mockImplementation((() => {
      callCount++;
      if (callCount <= 1) {
        return Promise.resolve({
          exitCode: 1,
          stdout: 'FAIL',
          stderr: 'test error',
        });
      }
      return Promise.resolve({ exitCode: 0, stdout: 'PASS', stderr: '' });
    }) as any);

    const mockAcpResult = {
      id: 'fix_agent',
      success: true,
      duration: 1.0,
      outputs: new Map([['result', 'fixed']]),
    };

    const mockAcpRunner = {
      createSession: vi.fn().mockResolvedValue('session-loop'),
      runStep: vi.fn().mockResolvedValue(mockAcpResult),
      closeSession: vi.fn(),
      stepsOutput: new Map<string, Map<string, string>>(),
    } as unknown as ACPRunner;

    const loopStep: WorkflowLoopStep = {
      id: 'test_loop',
      name: 'Test Loop',
      type: 'loop',
      until: 'steps.run_tests.outputs.exit_code == 0',
      maxIterations: 3,
      steps: [
        {
          id: 'run_tests',
          name: 'Run Tests',
          type: 'command',
          command: 'npm test',
        } as WorkflowCommandStep,
        {
          id: 'fix_agent',
          name: 'Fix',
          type: 'agent',
          prompt: 'Fix: {{steps.run_tests.outputs.stderr}}',
          outputs: [],
        } as WorkflowAgentStep,
      ],
    };

    const stepsOutput = new Map<string, Map<string, string>>();

    const result = await executeStep(loopStep, {
      workflow: createMockWorkflowManager(),
      inputs: new Map(),
      stepsOutput,
      totalSteps: 1,
      currentStepIndex: 0,
      acpRunner: mockAcpRunner,
    });

    expect(result.success).toBe(true);
    // fix_agent should have used acpRunner, not Runner.
    // The loop runs 2 iterations (first: test fails + fix, second: test passes + fix)
    // so createSession/closeSession are each called twice.
    expect(mockAcpRunner.createSession).toHaveBeenCalledTimes(2);
    expect(mockAcpRunner.runStep).toHaveBeenCalledWith('fix_agent');
    expect(mockAcpRunner.closeSession).toHaveBeenCalledTimes(2);
    expect(Runner).not.toHaveBeenCalled();
  });

  it('skips loop sub-steps whose if condition is not met', async () => {
    const { launch } = await import('rover-core');
    const { Runner } = await import('../runner.js');

    // Command always fails — but we want the fix_agent to be skipped via `if`
    vi.mocked(launch).mockResolvedValue({
      exitCode: 1,
      stdout: 'FAIL',
      stderr: 'error',
    } as any);

    const loopStep: WorkflowLoopStep = {
      id: 'if_loop',
      name: 'If Loop',
      type: 'loop',
      until: 'steps.run_tests.outputs.exit_code == 0',
      maxIterations: 1,
      steps: [
        {
          id: 'run_tests',
          name: 'Run Tests',
          type: 'command',
          command: 'npm test',
        } as WorkflowCommandStep,
        {
          id: 'fix_agent',
          name: 'Fix',
          type: 'agent',
          // Only run when tests fail with exit_code != 0 AND some_flag == true
          // Since some_flag is never set, this sub-step should be skipped.
          if: 'steps.run_tests.outputs.some_flag == true',
          prompt: 'Fix it',
          outputs: [],
        } as WorkflowAgentStep,
      ],
    };

    const stepsOutput = new Map<string, Map<string, string>>();

    const result = await executeStep(loopStep, {
      workflow: createMockWorkflowManager(),
      inputs: new Map(),
      stepsOutput,
      totalSteps: 1,
      currentStepIndex: 0,
    });

    // Loop ran 1 iteration, condition never met
    expect(result.success).toBe(false);
    expect(result.outputs.get('iterations')).toBe('1');
    // fix_agent should have been skipped (if condition not met)
    expect(Runner).not.toHaveBeenCalled();
    // fix_agent should still have an empty output entry from the skip
    expect(stepsOutput.get('fix_agent')).toEqual(new Map());
  });

  it('skips fix_agent via if-guard when tests pass on first iteration', async () => {
    const { launch } = await import('rover-core');
    const { Runner } = await import('../runner.js');

    // Command succeeds on the very first call
    vi.mocked(launch).mockResolvedValue({
      exitCode: 0,
      stdout: 'PASS',
      stderr: '',
    } as any);

    const loopStep: WorkflowLoopStep = {
      id: 'immediate_loop',
      name: 'Immediate Exit',
      type: 'loop',
      until: 'steps.run_tests.outputs.exit_code == 0',
      maxIterations: 5,
      steps: [
        {
          id: 'run_tests',
          name: 'Run Tests',
          type: 'command',
          command: 'npm test',
        } as WorkflowCommandStep,
        {
          id: 'fix_agent',
          name: 'Fix',
          type: 'agent',
          // Sub-steps use `if` guards to skip work when not needed.
          // The loop condition is checked at the end of each iteration.
          if: 'steps.run_tests.outputs.exit_code != 0',
          prompt: 'Fix it',
          outputs: [],
        } as WorkflowAgentStep,
      ],
    };

    const result = await executeStep(loopStep, {
      workflow: createMockWorkflowManager(),
      inputs: new Map(),
      stepsOutput: new Map(),
      totalSteps: 1,
      currentStepIndex: 0,
    });

    expect(result.success).toBe(true);
    expect(result.outputs.get('iterations')).toBe('1');
    // fix_agent should have been skipped via its `if` guard
    expect(Runner).not.toHaveBeenCalled();
  });

  it('workflow-level loopLimit caps per-step maxIterations', async () => {
    const { launch } = await import('rover-core');

    // Always fail so we exhaust iterations
    vi.mocked(launch).mockResolvedValue({
      exitCode: 1,
      stdout: 'FAIL',
      stderr: 'nope',
    } as any);

    const loopStep: WorkflowLoopStep = {
      id: 'capped_loop',
      name: 'Capped Loop',
      type: 'loop',
      until: 'steps.run_cmd.outputs.exit_code == 0',
      maxIterations: 10,
      steps: [
        {
          id: 'run_cmd',
          name: 'Run',
          type: 'command',
          command: 'false',
        } as WorkflowCommandStep,
      ],
    };

    const workflow = {
      ...createMockWorkflowManager(),
      config: { timeout: 3600, continueOnError: false, loopLimit: 3 },
    } as unknown as WorkflowManager;

    const result = await executeStep(loopStep, {
      workflow,
      inputs: new Map(),
      stepsOutput: new Map(),
      totalSteps: 1,
      currentStepIndex: 0,
    });

    expect(result.success).toBe(false);
    // loopLimit (3) should cap maxIterations (10)
    expect(result.outputs.get('iterations')).toBe('3');
  });

  it('loop step fails after max iterations', async () => {
    const { launch } = await import('rover-core');

    // Always fail
    vi.mocked(launch).mockResolvedValue({
      exitCode: 1,
      stdout: 'FAIL',
      stderr: 'always fails',
    } as any);

    const loopStep: WorkflowLoopStep = {
      id: 'fail_loop',
      name: 'Fail Loop',
      type: 'loop',
      until: 'steps.run_cmd.outputs.exit_code == 0',
      maxIterations: 2,
      steps: [
        {
          id: 'run_cmd',
          name: 'Run',
          type: 'command',
          command: 'false',
        } as WorkflowCommandStep,
      ],
    };

    const result = await executeStep(loopStep, {
      workflow: createMockWorkflowManager(),
      inputs: new Map(),
      stepsOutput: new Map(),
      totalSteps: 1,
      currentStepIndex: 0,
    });

    expect(result.id).toBe('fail_loop');
    expect(result.success).toBe(false);
    expect(result.outputs.get('condition_met')).toBe('false');
    expect(result.outputs.get('iterations')).toBe('2');
  });

  it('handles nested loops (loop inside loop)', async () => {
    const { launch } = await import('rover-core');

    // Inner loop command: fails once, then passes
    let innerCallCount = 0;
    vi.mocked(launch).mockImplementation((() => {
      innerCallCount++;
      if (innerCallCount <= 1) {
        return Promise.resolve({
          exitCode: 1,
          stdout: 'FAIL',
          stderr: 'inner error',
        });
      }
      return Promise.resolve({ exitCode: 0, stdout: 'PASS', stderr: '' });
    }) as any);

    const nestedLoop: WorkflowLoopStep = {
      id: 'outer_loop',
      name: 'Outer Loop',
      type: 'loop',
      until: 'steps.inner_cmd.outputs.exit_code == 0',
      maxIterations: 3,
      steps: [
        {
          id: 'inner_loop',
          name: 'Inner Loop',
          type: 'loop',
          until: 'steps.inner_cmd.outputs.exit_code == 0',
          maxIterations: 2,
          steps: [
            {
              id: 'inner_cmd',
              name: 'Inner Command',
              type: 'command',
              command: 'test_inner',
            } as WorkflowCommandStep,
          ],
        } as WorkflowLoopStep,
      ],
    };

    const stepsOutput = new Map<string, Map<string, string>>();

    const result = await executeStep(nestedLoop, {
      workflow: createMockWorkflowManager(),
      inputs: new Map(),
      stepsOutput,
      totalSteps: 1,
      currentStepIndex: 0,
    });

    // The inner loop should have resolved on 2nd call, satisfying the outer loop condition
    expect(result.success).toBe(true);
    expect(result.outputs.get('condition_met')).toBe('true');
    // inner_cmd output should be in stepsOutput
    expect(stepsOutput.get('inner_cmd')?.get('exit_code')).toBe('0');
  });

  it('resumes a loop from a saved sub-step boundary', async () => {
    const { launch } = await import('rover-core');
    const checkpointStore = {
      getLoopProgress: vi.fn().mockReturnValue({
        iteration: 2,
        nextSubStepIndex: 1,
        subStepOutputs: {
          run_tests: { exit_code: '1', stderr: 'failed previously' },
        },
        skippedSubSteps: [],
      }),
      setLoopProgress: vi.fn(),
      clearLoopProgress: vi.fn(),
    };

    vi.mocked(launch).mockResolvedValue({
      exitCode: 0,
      stdout: 'PASS',
      stderr: '',
    } as any);

    const loopStep: WorkflowLoopStep = {
      id: 'resume_loop',
      name: 'Resume Loop',
      type: 'loop',
      until: 'steps.run_tests.outputs.exit_code == 0',
      maxIterations: 3,
      steps: [
        {
          id: 'run_tests',
          name: 'Run Tests',
          type: 'command',
          command: 'npm test',
        } as WorkflowCommandStep,
        {
          id: 'fix_agent',
          name: 'Fix',
          type: 'agent',
          prompt: 'Fix: {{steps.run_tests.outputs.stderr}}',
          outputs: [],
        } as WorkflowAgentStep,
      ],
    };

    const stepsOutput = new Map<string, Map<string, string>>();

    const result = await executeStep(loopStep, {
      workflow: createMockWorkflowManager(),
      inputs: new Map(),
      stepsOutput,
      totalSteps: 1,
      currentStepIndex: 0,
      checkpointStore: checkpointStore as any,
    });

    expect(result.success).toBe(true);
    expect(result.outputs.get('iterations')).toBe('3');
    expect(launch).toHaveBeenCalledOnce();
    expect(stepsOutput.get('run_tests')?.get('exit_code')).toBe('0');
    expect(checkpointStore.setLoopProgress).toHaveBeenCalledWith(
      'resume_loop',
      expect.objectContaining({
        iteration: 3,
        nextSubStepIndex: 1,
      })
    );
    expect(checkpointStore.clearLoopProgress).toHaveBeenCalledWith(
      'resume_loop'
    );
  });

  it('re-evaluates until before advancing when resuming at end-of-iteration', async () => {
    const { launch } = await import('rover-core');
    const checkpointStore = {
      getLoopProgress: vi.fn().mockReturnValue({
        iteration: 2,
        nextSubStepIndex: 1,
        subStepOutputs: {
          run_tests: { exit_code: '0', stdout: 'already passing' },
        },
        skippedSubSteps: [],
      }),
      setLoopProgress: vi.fn(),
      clearLoopProgress: vi.fn(),
    };

    const loopStep: WorkflowLoopStep = {
      id: 'resume_until_boundary_loop',
      name: 'Resume Until Boundary Loop',
      type: 'loop',
      until: 'steps.run_tests.outputs.exit_code == 0',
      maxIterations: 3,
      steps: [
        {
          id: 'run_tests',
          name: 'Run Tests',
          type: 'command',
          command: 'npm test',
        } as WorkflowCommandStep,
      ],
    };

    const result = await executeStep(loopStep, {
      workflow: createMockWorkflowManager(),
      inputs: new Map(),
      stepsOutput: new Map(),
      totalSteps: 1,
      currentStepIndex: 0,
      checkpointStore: checkpointStore as any,
    });

    expect(result.success).toBe(true);
    expect(result.outputs.get('iterations')).toBe('2');
    expect(launch).not.toHaveBeenCalled();
    expect(checkpointStore.clearLoopProgress).toHaveBeenCalledWith(
      'resume_until_boundary_loop'
    );
  });

  it('restores skipped loop sub-steps as empty outputs on resume', async () => {
    const { launch } = await import('rover-core');
    const checkpointStore = {
      getLoopProgress: vi.fn().mockReturnValue({
        iteration: 1,
        nextSubStepIndex: 1,
        subStepOutputs: {
          run_tests: { exit_code: '0', stdout: 'PASS' },
        },
        skippedSubSteps: ['fix_agent'],
      }),
      setLoopProgress: vi.fn(),
      clearLoopProgress: vi.fn(),
    };

    vi.mocked(launch).mockResolvedValue({
      exitCode: 0,
      stdout: 'PASS',
      stderr: '',
    } as any);

    const loopStep: WorkflowLoopStep = {
      id: 'skip_resume_loop',
      name: 'Skip Resume Loop',
      type: 'loop',
      until: 'steps.run_tests.outputs.exit_code == 0',
      maxIterations: 2,
      steps: [
        {
          id: 'run_tests',
          name: 'Run Tests',
          type: 'command',
          command: 'npm test',
        } as WorkflowCommandStep,
        {
          id: 'fix_agent',
          name: 'Fix',
          type: 'agent',
          if: 'steps.run_tests.outputs.exit_code != 0',
          prompt: 'Fix it',
          outputs: [],
        } as WorkflowAgentStep,
      ],
    };

    const stepsOutput = new Map<string, Map<string, string>>();

    const result = await executeStep(loopStep, {
      workflow: createMockWorkflowManager(),
      inputs: new Map(),
      stepsOutput,
      totalSteps: 1,
      currentStepIndex: 0,
      checkpointStore: checkpointStore as any,
    });

    expect(result.success).toBe(true);
    expect(stepsOutput.get('fix_agent')).toEqual(new Map());
    expect(checkpointStore.clearLoopProgress).toHaveBeenCalledWith(
      'skip_resume_loop'
    );
  });

  it('clears invalid saved loop progress and restarts the loop', async () => {
    const { launch } = await import('rover-core');
    const checkpointStore = {
      getLoopProgress: vi.fn().mockReturnValue({
        iteration: 1,
        nextSubStepIndex: -1,
        subStepOutputs: {},
        skippedSubSteps: [],
      }),
      setLoopProgress: vi.fn(),
      clearLoopProgress: vi.fn(),
    };

    vi.mocked(launch).mockResolvedValue({
      exitCode: 0,
      stdout: 'PASS',
      stderr: '',
    } as any);

    const loopStep: WorkflowLoopStep = {
      id: 'invalid_resume_loop',
      name: 'Invalid Resume Loop',
      type: 'loop',
      until: 'steps.run_cmd.outputs.exit_code == 0',
      maxIterations: 2,
      steps: [
        {
          id: 'run_cmd',
          name: 'Run',
          type: 'command',
          command: 'true',
        } as WorkflowCommandStep,
      ],
    };

    const result = await executeStep(loopStep, {
      workflow: createMockWorkflowManager(),
      inputs: new Map(),
      stepsOutput: new Map(),
      totalSteps: 1,
      currentStepIndex: 0,
      checkpointStore: checkpointStore as any,
    });

    expect(result.success).toBe(true);
    expect(launch).toHaveBeenCalledOnce();
    expect(checkpointStore.clearLoopProgress).toHaveBeenCalledWith(
      'invalid_resume_loop'
    );
  });

  it('shouldSkipStep returns true when if condition is false (callers skip before executeStep)', () => {
    const agentStep: WorkflowAgentStep = {
      id: 'conditional_agent',
      name: 'Conditional Agent',
      type: 'agent',
      if: 'steps.review.outputs.issues_found == true',
      prompt: 'Do something',
      outputs: [],
    };

    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('review', new Map([['issues_found', 'false']]));

    // Callers (run.ts, executeLoopStep) check shouldSkipStep before calling executeStep
    expect(shouldSkipStep(agentStep, stepsOutput)).toBe(true);
  });

  it('runs step when if condition is true', async () => {
    const agentStep: WorkflowAgentStep = {
      id: 'conditional_agent',
      name: 'Conditional Agent',
      type: 'agent',
      if: 'steps.review.outputs.issues_found == true',
      prompt: 'Do something',
      outputs: [],
    };

    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('review', new Map([['issues_found', 'true']]));

    const result = await executeStep(agentStep, {
      workflow: createMockWorkflowManager(),
      inputs: new Map(),
      stepsOutput,
      totalSteps: 1,
      currentStepIndex: 0,
    });

    // Step should have run (via mocked Runner)
    expect(result.id).toBe('mock_agent');
    expect(result.success).toBe(true);
  });

  it('throws for unsupported step type', async () => {
    const unknownStep = {
      id: 'unknown',
      name: 'Unknown',
      type: 'unknown',
    } as any;

    await expect(
      executeStep(unknownStep, {
        workflow: createMockWorkflowManager(),
        inputs: new Map(),
        stepsOutput: new Map(),
        totalSteps: 1,
        currentStepIndex: 0,
      })
    ).rejects.toThrow('Unsupported step type');
  });

  it('loop with maxIterations=0 never executes body', async () => {
    const { launch } = await import('rover-core');
    const { Runner } = await import('../runner.js');

    const loopStep: WorkflowLoopStep = {
      id: 'zero_loop',
      name: 'Zero Iterations',
      type: 'loop',
      until: 'steps.run_cmd.outputs.exit_code == 0',
      maxIterations: 0,
      steps: [
        {
          id: 'run_cmd',
          name: 'Run',
          type: 'command',
          command: 'echo hello',
        } as WorkflowCommandStep,
        {
          id: 'agent_step',
          name: 'Agent',
          type: 'agent',
          prompt: 'Do something',
          outputs: [],
        } as WorkflowAgentStep,
      ],
    };

    const stepsOutput = new Map<string, Map<string, string>>();

    const result = await executeStep(loopStep, {
      workflow: createMockWorkflowManager(),
      inputs: new Map(),
      stepsOutput,
      totalSteps: 1,
      currentStepIndex: 0,
    });

    expect(result.id).toBe('zero_loop');
    // Loop body never ran, condition was never checked, so success is false
    expect(result.success).toBe(false);
    expect(result.outputs.get('iterations')).toBe('0');
    expect(result.outputs.get('condition_met')).toBe('false');
    // No sub-steps should have been executed
    expect(launch).not.toHaveBeenCalled();
    expect(Runner).not.toHaveBeenCalled();
    // No sub-step outputs should exist
    expect(stepsOutput.has('run_cmd')).toBe(false);
    expect(stepsOutput.has('agent_step')).toBe(false);
  });

  it('PauseWorkflowError propagates from loop sub-step without being caught', async () => {
    const { launch } = await import('rover-core');
    const { Runner } = await import('../runner.js');

    // First sub-step (command) succeeds
    vi.mocked(launch).mockResolvedValue({
      exitCode: 0,
      stdout: 'PASS',
      stderr: '',
    } as any);

    // Second sub-step (agent) returns a retryable failure, which triggers PauseWorkflowError
    vi.mocked(Runner).mockImplementation(
      () =>
        ({
          run: vi.fn().mockResolvedValue({
            id: 'failing_agent',
            success: false,
            duration: 1.0,
            error: 'credit limit exceeded',
            outputs: new Map([['error_retryable', 'true']]),
          }),
          tool: 'claude',
        }) as any
    );

    const loopStep: WorkflowLoopStep = {
      id: 'pause_loop',
      name: 'Pause Loop',
      type: 'loop',
      until: 'steps.run_cmd.outputs.exit_code == 0',
      maxIterations: 3,
      steps: [
        {
          id: 'run_cmd',
          name: 'Run Command',
          type: 'command',
          command: 'npm test',
        } as WorkflowCommandStep,
        {
          id: 'failing_agent',
          name: 'Failing Agent',
          type: 'agent',
          prompt: 'Fix something',
          outputs: [],
        } as WorkflowAgentStep,
      ],
    };

    const stepsOutput = new Map<string, Map<string, string>>();

    // The PauseWorkflowError should propagate up through the loop
    await expect(
      executeStep(loopStep, {
        workflow: createMockWorkflowManager(),
        inputs: new Map(),
        stepsOutput,
        totalSteps: 1,
        currentStepIndex: 0,
      })
    ).rejects.toThrow(PauseWorkflowError);

    // Verify the error is indeed a PauseWorkflowError instance
    try {
      await executeStep(loopStep, {
        workflow: createMockWorkflowManager(),
        inputs: new Map(),
        stepsOutput: new Map(),
        totalSteps: 1,
        currentStepIndex: 0,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(PauseWorkflowError);
      expect((err as PauseWorkflowError).message).toContain('retryable error');
    }

    // The command sub-step that completed before the error should have its outputs stored
    expect(stepsOutput.get('run_cmd')?.get('exit_code')).toBe('0');
    expect(stepsOutput.get('run_cmd')?.get('stdout')).toBe('PASS');
  });
});

describe('shouldSkipStep', () => {
  it('returns false when step has no if field', () => {
    const step: WorkflowAgentStep = {
      id: 'no_condition',
      name: 'No Condition',
      type: 'agent',
      prompt: 'Do something',
      outputs: [],
    };

    expect(shouldSkipStep(step, new Map())).toBe(false);
  });

  it('returns true when if condition evaluates to false', () => {
    const step: WorkflowAgentStep = {
      id: 'cond_step',
      name: 'Conditional',
      type: 'agent',
      if: 'steps.review.outputs.issues_found == true',
      prompt: 'Fix issues',
      outputs: [],
    };

    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('review', new Map([['issues_found', 'false']]));

    expect(shouldSkipStep(step, stepsOutput)).toBe(true);
  });

  it('returns false when if condition evaluates to true', () => {
    const step: WorkflowAgentStep = {
      id: 'cond_step',
      name: 'Conditional',
      type: 'agent',
      if: 'steps.review.outputs.issues_found == true',
      prompt: 'Fix issues',
      outputs: [],
    };

    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('review', new Map([['issues_found', 'true']]));

    expect(shouldSkipStep(step, stepsOutput)).toBe(false);
  });

  it('returns true when referenced step has not produced output yet', () => {
    const step: WorkflowCommandStep = {
      id: 'dependent_cmd',
      name: 'Dependent Command',
      type: 'command',
      if: 'steps.previous.outputs.ready == true',
      command: 'echo go',
    };

    // stepsOutput has no entry for "previous"
    expect(shouldSkipStep(step, new Map())).toBe(true);
  });

  it('works with != operator', () => {
    const step: WorkflowAgentStep = {
      id: 'not_equal',
      name: 'Not Equal',
      type: 'agent',
      if: 'steps.test.outputs.exit_code != 0',
      prompt: 'Fix failing tests',
      outputs: [],
    };

    // exit_code is 0 → condition "!= 0" is false → skip
    const passing = new Map<string, Map<string, string>>();
    passing.set('test', new Map([['exit_code', '0']]));
    expect(shouldSkipStep(step, passing)).toBe(true);

    // exit_code is 1 → condition "!= 0" is true → don't skip
    const failing = new Map<string, Map<string, string>>();
    failing.set('test', new Map([['exit_code', '1']]));
    expect(shouldSkipStep(step, failing)).toBe(false);
  });
});

describe('isTransientError', () => {
  it('matches network errors', () => {
    expect(isTransientError('ECONNREFUSED')).toBe(true);
    expect(isTransientError('ETIMEDOUT')).toBe(true);
    expect(isTransientError('ENETUNREACH')).toBe(true);
  });

  it('matches rate limit codes', () => {
    expect(isTransientError('too many requests')).toBe(true);
    expect(isTransientError('HTTP 429')).toBe(true);
  });

  it('does not match general text containing credit', () => {
    expect(isTransientError('checking credit card balance')).toBe(false);
  });

  it('does not match empty string', () => {
    expect(isTransientError('')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isTransientError('Network_Error')).toBe(true);
    expect(isTransientError('CONNECTION_REFUSED')).toBe(true);
    expect(isTransientError('Too Many Requests')).toBe(true);
  });

  it('does NOT match generic "timeout" (prevents infinite retry loops)', () => {
    expect(isTransientError('timeout')).toBe(false);
    expect(isTransientError('Request timeout')).toBe(false);
    expect(isTransientError('Timeout waiting for response')).toBe(false);
    expect(isTransientError('Step execution timeout after 300s')).toBe(false);
    expect(isTransientError('Task timed out')).toBe(false);
  });
});
