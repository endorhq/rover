import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { JsonlLogger, type StepResult } from 'rover-core';

// ── Track process.exit calls ────────────────────────────────────────────
let capturedExitCode: number | undefined;

// ── Mock Runner ─────────────────────────────────────────────────────────
const runnerInstances: Array<{ run: Mock }> = [];

vi.mock('../../lib/runner.js', () => ({
  Runner: vi.fn().mockImplementation(() => {
    const instance = { run: vi.fn() };
    runnerInstances.push(instance);
    return instance;
  }),
}));

// ── Mock ACPRunner ──────────────────────────────────────────────────────
const mockACPRunStep = vi.fn<() => Promise<StepResult>>();
const mockACPInitializeConnection = vi.fn().mockResolvedValue(undefined);
const mockACPCreateSession = vi.fn().mockResolvedValue('session-1');
const mockACPCloseSession = vi.fn();
const mockACPClose = vi.fn();
const mockACPStepsOutput = new Map<string, Map<string, string>>();

vi.mock('../../lib/acp-runner.js', () => ({
  ACPRunner: vi.fn().mockImplementation(() => ({
    initializeConnection: mockACPInitializeConnection,
    createSession: mockACPCreateSession,
    runStep: mockACPRunStep,
    closeSession: mockACPCloseSession,
    close: mockACPClose,
    stepsOutput: mockACPStepsOutput,
  })),
}));

// ── Mock agents/index and step-executor (required by run.ts imports) ────
vi.mock('../../lib/agents/index.js', () => ({
  createAgent: vi.fn().mockReturnValue({ getLogSources: () => [] }),
}));

vi.mock('../../lib/step-executor.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../lib/step-executor.js')>();
  return {
    ...actual,
    executeStep: vi.fn(actual.executeStep),
    shouldSkipStep: vi.fn().mockReturnValue(false),
  };
});

// ── Import after mocks ─────────────────────────────────────────────────
import { runCommand } from '../run.js';
import { Runner } from '../../lib/runner.js';
import { ACPRunner } from '../../lib/acp-runner.js';

// ── Workflow YAML template ──────────────────────────────────────────────
const WORKFLOW_YAML = (tool: string) => `
version: "1.0"
name: test-pause-resume
description: Multi-step workflow for testing
defaults:
  tool: ${tool}
steps:
  - id: step1
    type: agent
    name: Step 1
    prompt: "Do step 1"
    outputs:
      - name: result1
        description: Result of step 1
        type: string
  - id: step2
    type: agent
    name: Step 2
    prompt: "Do step 2 using {{steps.step1.outputs.result1}}"
    outputs:
      - name: result2
        description: Result of step 2
        type: string
  - id: step3
    type: agent
    name: Step 3
    prompt: "Do step 3"
    outputs:
      - name: result3
        description: Result of step 3
        type: string
`;

// ── Helpers ─────────────────────────────────────────────────────────────
function makeResult(
  id: string,
  success: boolean,
  extra?: { error?: string; outputs?: Map<string, string> }
): StepResult {
  const outputs = new Map<string, string>();
  if (extra?.outputs) {
    for (const [k, v] of extra.outputs.entries()) {
      outputs.set(k, v);
    }
  }
  return {
    id,
    success,
    duration: 1.0,
    outputs,
    error: extra?.error,
  };
}

function readStatusFile(statusPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(statusPath, 'utf8'));
}

function readCheckpointFile(outputDir: string): Record<string, unknown> | null {
  const p = join(outputDir, 'checkpoint.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

// ── Test Suite ──────────────────────────────────────────────────────────
describe('run command: pause/resume integration', () => {
  let tempDir: string;
  let workflowPath: string;
  let outputDir: string;
  let statusPath: string;

  beforeEach(() => {
    vi.useFakeTimers();
    capturedExitCode = undefined;

    tempDir = mkdtempSync(join(tmpdir(), 'rover-pause-resume-test-'));
    outputDir = join(tempDir, 'output');
    mkdirSync(outputDir, { recursive: true });
    statusPath = join(tempDir, 'status.json');

    // Mock process.exit to capture exit code without throwing
    vi.spyOn(process, 'exit').mockImplementation(
      (code?: string | number | null | undefined) => {
        capturedExitCode = Number(code ?? 0);
        return undefined as never;
      }
    );

    // Reset all mock state (use mockClear to preserve implementations)
    runnerInstances.length = 0;
    mockACPRunStep.mockClear();
    mockACPInitializeConnection.mockClear().mockResolvedValue(undefined);
    mockACPCreateSession.mockClear().mockResolvedValue('session-1');
    mockACPCloseSession.mockClear();
    mockACPClose.mockClear();
    mockACPStepsOutput.clear();
    (Runner as unknown as Mock).mockClear();
    (ACPRunner as unknown as Mock).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Only restore process.exit spy; don't use restoreAllMocks() since that
    // wipes vi.mock() factory implementations (ACPRunner constructor etc.)
    vi.mocked(process.exit).mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Helper to write workflow YAML ───────────────────────────────────
  function writeWorkflow(tool = 'codex') {
    workflowPath = join(tempDir, 'workflow.yaml');
    writeFileSync(workflowPath, WORKFLOW_YAML(tool), 'utf8');
  }

  // ── Helper to run the command and capture exit ──────────────────────
  async function runAndCapture(
    opts: { agentTool?: string; checkpoint?: string } = {}
  ): Promise<number> {
    const promise = runCommand(workflowPath, {
      input: [],
      output: outputDir,
      taskId: 'test-task-1',
      statusFile: statusPath,
      agentTool: opts.agentTool,
      checkpoint: opts.checkpoint,
    });
    // Advance timers to flush any sleep() calls
    await vi.runAllTimersAsync();
    await promise;
    return capturedExitCode ?? -1;
  }

  // ────────────────────────────────────────────────────────────────────
  // Standard Mode Tests (Runner, tool=codex — non-ACP tool)
  // ────────────────────────────────────────────────────────────────────

  describe('Standard mode (Runner)', () => {
    /**
     * Setup run mocks for standard mode.
     * Each result is assigned to the Nth Runner instance created.
     */
    function setupRunnerResults(results: StepResult[]) {
      // Runner constructor creates instances; each gets its own run mock.
      // We pre-configure the results so that instance N returns results[N].
      let callIndex = 0;
      (Runner as unknown as Mock).mockImplementation(() => {
        const idx = callIndex++;
        const instance = {
          run: vi.fn().mockResolvedValue(results[idx]),
        };
        runnerInstances.push(instance);
        return instance;
      });
    }

    it('Test 1: all steps succeed → exit 0, no checkpoint, status completed', async () => {
      writeWorkflow();

      setupRunnerResults([
        makeResult('step1', true, {
          outputs: new Map([['result1', 'hello']]),
        }),
        makeResult('step2', true, {
          outputs: new Map([['result2', 'world']]),
        }),
        makeResult('step3', true, {
          outputs: new Map([['result3', 'done']]),
        }),
      ]);

      const exitCode = await runAndCapture();

      expect(exitCode).toBe(0);
      expect(readCheckpointFile(outputDir)).toBeNull();

      const status = readStatusFile(statusPath);
      expect(status.status).toBe('completed');
    });

    it('Test 2: non-retryable error → exit 1, checkpoint isRetryable=false, status failed', async () => {
      writeWorkflow();

      setupRunnerResults([
        makeResult('step1', true, {
          outputs: new Map([['result1', 'hello']]),
        }),
        makeResult('step2', false, {
          error: 'invalid api key',
          outputs: new Map([['error_retryable', 'false']]),
        }),
      ]);

      const exitCode = await runAndCapture();

      expect(exitCode).toBe(1);

      const checkpoint = readCheckpointFile(outputDir);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.failedStepId).toBe('step2');
      expect(checkpoint!.isRetryable).toBe(false);
      expect(
        (checkpoint!.completedSteps as Array<{ id: string }>).map(s => s.id)
      ).toEqual(['step1']);

      const status = readStatusFile(statusPath);
      expect(status.status).toBe('failed');
    });

    it('Test 3: retryable error → exit 2, checkpoint isRetryable=true, status paused', async () => {
      writeWorkflow();
      const loggerInfoSpy = vi.spyOn(JsonlLogger.prototype, 'info');
      try {
        setupRunnerResults([
          makeResult('step1', true, {
            outputs: new Map([['result1', 'hello']]),
          }),
          makeResult('step2', false, {
            error: 'Rate limit exceeded',
            outputs: new Map([['error_retryable', 'true']]),
          }),
        ]);

        const exitCode = await runAndCapture();

        expect(exitCode).toBe(2);

        const checkpoint = readCheckpointFile(outputDir);
        expect(checkpoint).not.toBeNull();
        expect(checkpoint!.isRetryable).toBe(true);
        expect(checkpoint!.failedStepId).toBe('step2');

        const status = readStatusFile(statusPath);
        expect(status.status).toBe('paused');
        expect(loggerInfoSpy).toHaveBeenCalledWith(
          'workflow_pause',
          expect.stringContaining('Workflow paused due to retryable error'),
          expect.objectContaining({
            taskId: 'test-task-1',
            metadata: { reason: 'retryable_error' },
          })
        );
      } finally {
        loggerInfoSpy.mockRestore();
      }
    });

    it('Test 3b: repeated HTTP 429 retries still pause the workflow', async () => {
      writeWorkflow();

      setupRunnerResults([
        makeResult('step1', true, {
          outputs: new Map([['result1', 'hello']]),
        }),
        makeResult('step2', false, {
          error: 'HTTP 429 Too Many Requests',
        }),
        makeResult('step2', false, {
          error: 'HTTP 429 Too Many Requests',
        }),
        makeResult('step2', false, {
          error: 'HTTP 429 Too Many Requests',
        }),
      ]);

      const exitCode = await runAndCapture();

      expect(exitCode).toBe(2);

      const checkpoint = readCheckpointFile(outputDir);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.isRetryable).toBe(true);
      expect(checkpoint!.failedStepId).toBe('step2');

      const status = readStatusFile(statusPath);
      expect(status.status).toBe('paused');
    });

    it('Test 4: resume from checkpoint skips completed steps', async () => {
      writeWorkflow();

      // Pre-write checkpoint with step1 completed
      const checkpointPath = join(outputDir, 'checkpoint.json');
      writeFileSync(
        checkpointPath,
        JSON.stringify({
          completedSteps: [{ id: 'step1', outputs: { result1: 'hello' } }],
          failedStepId: 'step2',
          error: 'Rate limit exceeded',
          isRetryable: true,
        }),
        'utf8'
      );

      // Only step2 and step3 should run
      setupRunnerResults([
        makeResult('step2', true, {
          outputs: new Map([['result2', 'world']]),
        }),
        makeResult('step3', true, {
          outputs: new Map([['result3', 'done']]),
        }),
      ]);

      const exitCode = await runAndCapture({ checkpoint: checkpointPath });

      expect(exitCode).toBe(0);

      // Runner should be instantiated only for step2 and step3 (not step1)
      expect(Runner).toHaveBeenCalledTimes(2);
      const constructorCalls = (Runner as unknown as Mock).mock.calls;
      // The second argument to Runner constructor is the stepId
      expect(constructorCalls[0][1]).toBe('step2');
      expect(constructorCalls[1][1]).toBe('step3');

      const status = readStatusFile(statusPath);
      expect(status.status).toBe('completed');
    });

    it('persists newly completed steps back into the checkpoint during a resumed run', async () => {
      writeWorkflow();

      const checkpointPath = join(outputDir, 'checkpoint.json');
      writeFileSync(
        checkpointPath,
        JSON.stringify({
          completedSteps: [{ id: 'step1', outputs: { result1: 'hello' } }],
          failedStepId: 'step2',
          error: 'Rate limit exceeded',
          isRetryable: true,
        }),
        'utf8'
      );

      setupRunnerResults([
        makeResult('step2', true, {
          outputs: new Map([['result2', 'world']]),
        }),
        makeResult('step3', false, {
          error: 'command failed',
          outputs: new Map([['error_retryable', 'false']]),
        }),
      ]);

      const exitCode = await runAndCapture({ checkpoint: checkpointPath });

      expect(exitCode).toBe(1);

      const checkpoint = readCheckpointFile(outputDir);
      expect(checkpoint).not.toBeNull();
      expect(
        (checkpoint!.completedSteps as Array<{ id: string }>).map(s => s.id)
      ).toEqual(['step1', 'step2']);
      expect(checkpoint!.failedStepId).toBe('step3');
    });

    it('Test 5: transient error retries then pauses', async () => {
      writeWorkflow();

      // step1 fails 3 times with transient error (initial + 2 retries)
      const transientResult = makeResult('step1', false, {
        error: 'connect ECONNREFUSED 127.0.0.1:443',
        outputs: new Map([['error_retryable', 'true']]),
      });
      setupRunnerResults([transientResult, transientResult, transientResult]);

      const exitCode = await runAndCapture();

      expect(exitCode).toBe(2);

      // Runner instantiated 3 times for step1: initial + 2 retries
      expect(Runner).toHaveBeenCalledTimes(3);

      const checkpoint = readCheckpointFile(outputDir);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.failedStepId).toBe('step1');
      expect(checkpoint!.isRetryable).toBe(true);
    });

    it('Test 6: transient error succeeds on retry → no pause', async () => {
      writeWorkflow();

      // step1 attempt 1: transient failure. attempt 2: success.
      // step2 and step3: success.
      setupRunnerResults([
        makeResult('step1', false, {
          error: 'connect ECONNREFUSED 127.0.0.1:443',
          outputs: new Map([['error_retryable', 'true']]),
        }),
        makeResult('step1', true, {
          outputs: new Map([['result1', 'hello']]),
        }),
        makeResult('step2', true, {
          outputs: new Map([['result2', 'world']]),
        }),
        makeResult('step3', true, {
          outputs: new Map([['result3', 'done']]),
        }),
      ]);

      const exitCode = await runAndCapture();

      expect(exitCode).toBe(0);
      expect(readCheckpointFile(outputDir)).toBeNull();

      const status = readStatusFile(statusPath);
      expect(status.status).toBe('completed');
    });

    it('marks SIGTERM-interrupted runs as paused before exiting', async () => {
      writeWorkflow();

      (Runner as unknown as Mock).mockImplementation(() => ({
        run: vi.fn().mockImplementation(async () => {
          process.emit('SIGTERM');
          return makeResult('step1', false, {
            error: 'interrupted after SIGTERM',
          });
        }),
      }));

      await runCommand(workflowPath, {
        input: [],
        output: outputDir,
        taskId: 'test-task-1',
        statusFile: statusPath,
      });

      expect(vi.mocked(process.exit).mock.calls[0]?.[0]).toBe(2);

      const checkpoint = readCheckpointFile(outputDir);
      expect(checkpoint).not.toBeNull();

      const status = readStatusFile(statusPath);
      expect(status.status).toBe('paused');
      expect(status.error).toBe('Workflow paused by SIGTERM signal');
    });

    it('marks SIGINT-interrupted runs as paused before exiting', async () => {
      writeWorkflow();

      (Runner as unknown as Mock).mockImplementation(() => ({
        run: vi.fn().mockImplementation(async () => {
          process.emit('SIGINT');
          return makeResult('step1', false, {
            error: 'interrupted after SIGINT',
          });
        }),
      }));

      await runCommand(workflowPath, {
        input: [],
        output: outputDir,
        taskId: 'test-task-1',
        statusFile: statusPath,
      });

      expect(vi.mocked(process.exit).mock.calls[0]?.[0]).toBe(2);

      const checkpoint = readCheckpointFile(outputDir);
      expect(checkpoint).not.toBeNull();

      const status = readStatusFile(statusPath);
      expect(status.status).toBe('paused');
      expect(status.error).toBe('Workflow paused by SIGINT signal');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // ACP Mode Tests (ACPRunner, tool=claude)
  // ────────────────────────────────────────────────────────────────────

  describe('ACP mode (ACPRunner)', () => {
    it('Test 7: retryable error (credit limit) → exit 2, status paused', async () => {
      writeWorkflow('claude');

      mockACPRunStep
        .mockResolvedValueOnce(
          makeResult('step1', true, {
            outputs: new Map([['result1', 'hello']]),
          })
        )
        .mockResolvedValueOnce(
          makeResult('step2', false, {
            error: "You've hit your limit",
          })
        );

      const exitCode = await runAndCapture();

      expect(exitCode).toBe(2);

      const checkpoint = readCheckpointFile(outputDir);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.isRetryable).toBe(true);
      expect(checkpoint!.failedStepId).toBe('step2');

      const status = readStatusFile(statusPath);
      expect(status.status).toBe('paused');
    });

    it('Test 8: non-retryable error → exit 1, status failed', async () => {
      writeWorkflow('claude');

      mockACPRunStep.mockResolvedValueOnce(
        makeResult('step1', false, {
          error: 'invalid api key',
        })
      );

      const exitCode = await runAndCapture();

      expect(exitCode).toBe(1);

      const checkpoint = readCheckpointFile(outputDir);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.isRetryable).toBe(false);
      expect(checkpoint!.failedStepId).toBe('step1');

      const status = readStatusFile(statusPath);
      expect(status.status).toBe('failed');
    });

    it('Test 9: resume in ACP mode skips completed steps', async () => {
      writeWorkflow('claude');

      // Pre-write checkpoint with step1 completed
      const checkpointPath = join(outputDir, 'checkpoint.json');
      writeFileSync(
        checkpointPath,
        JSON.stringify({
          completedSteps: [{ id: 'step1', outputs: { result1: 'hello' } }],
          failedStepId: 'step2',
          error: "You've hit your limit",
          isRetryable: true,
        }),
        'utf8'
      );

      // Only step2 and step3 should run via ACP
      mockACPRunStep
        .mockResolvedValueOnce(
          makeResult('step2', true, {
            outputs: new Map([['result2', 'world']]),
          })
        )
        .mockResolvedValueOnce(
          makeResult('step3', true, {
            outputs: new Map([['result3', 'done']]),
          })
        );

      const exitCode = await runAndCapture({ checkpoint: checkpointPath });

      expect(exitCode).toBe(0);

      // runStep should only be called for step2 and step3
      expect(mockACPRunStep).toHaveBeenCalledTimes(2);
      const calls = mockACPRunStep.mock.calls as unknown as string[][];
      expect(calls[0]?.[0]).toBe('step2');
      expect(calls[1]?.[0]).toBe('step3');

      const status = readStatusFile(statusPath);
      expect(status.status).toBe('completed');
    });

    it('Test 10: checkpoint loading with invalid file falls back to full run', async () => {
      writeWorkflow('claude');

      // Write garbage to checkpoint.json
      const checkpointPath = join(outputDir, 'bad-checkpoint.json');
      writeFileSync(checkpointPath, 'NOT VALID JSON {{{', 'utf8');

      // All 3 steps should run since checkpoint is invalid
      mockACPRunStep
        .mockResolvedValueOnce(
          makeResult('step1', true, {
            outputs: new Map([['result1', 'hello']]),
          })
        )
        .mockResolvedValueOnce(
          makeResult('step2', true, {
            outputs: new Map([['result2', 'world']]),
          })
        )
        .mockResolvedValueOnce(
          makeResult('step3', true, {
            outputs: new Map([['result3', 'done']]),
          })
        );

      const exitCode = await runAndCapture({ checkpoint: checkpointPath });

      expect(exitCode).toBe(0);

      // All 3 steps should have been executed
      expect(mockACPRunStep).toHaveBeenCalledTimes(3);

      const status = readStatusFile(statusPath);
      expect(status.status).toBe('completed');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Full Lifecycle: pause → checkpoint → resume → complete
  // ────────────────────────────────────────────────────────────────────

  describe('Full pause → resume → complete lifecycle', () => {
    it('pauses on credit limit, then resumes from checkpoint and completes', async () => {
      writeWorkflow();

      // Phase 1: step1 succeeds, step2 hits credit limit → pause (exit 2)
      let callIndex = 0;
      const phase1Results = [
        makeResult('step1', true, {
          outputs: new Map([['result1', 'hello']]),
        }),
        makeResult('step2', false, {
          error: "You've hit your limit · resets 2pm",
          outputs: new Map([['error_retryable', 'true']]),
        }),
      ];
      (Runner as unknown as Mock).mockImplementation(() => {
        const idx = callIndex++;
        const instance = {
          run: vi.fn().mockResolvedValue(phase1Results[idx]),
        };
        runnerInstances.push(instance);
        return instance;
      });

      const exitCode1 = await runAndCapture();

      // Verify pause state
      expect(exitCode1).toBe(2);

      const checkpoint = readCheckpointFile(outputDir);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.isRetryable).toBe(true);
      expect(checkpoint!.failedStepId).toBe('step2');
      expect(
        (checkpoint!.completedSteps as Array<{ id: string }>).map(s => s.id)
      ).toEqual(['step1']);

      const pausedStatus = readStatusFile(statusPath);
      expect(pausedStatus.status).toBe('paused');

      // Phase 2: resume from checkpoint — step1 skipped, step2+step3 succeed
      const checkpointPath = join(outputDir, 'checkpoint.json');

      // Reset mocks for phase 2
      runnerInstances.length = 0;
      (Runner as unknown as Mock).mockClear();
      callIndex = 0;
      (Runner as unknown as Mock).mockImplementation(() => {
        const idx = callIndex++;
        const results = [
          makeResult('step2', true, {
            outputs: new Map([['result2', 'world']]),
          }),
          makeResult('step3', true, {
            outputs: new Map([['result3', 'done']]),
          }),
        ];
        const instance = { run: vi.fn().mockResolvedValue(results[idx]) };
        runnerInstances.push(instance);
        return instance;
      });

      // Write a fresh status file for the resume run
      writeFileSync(statusPath, '{}', 'utf8');

      const exitCode2 = await runAndCapture({ checkpoint: checkpointPath });

      // Verify completion
      expect(exitCode2).toBe(0);

      // Only step2 and step3 should have been run (step1 was skipped)
      expect(Runner).toHaveBeenCalledTimes(2);
      const constructorCalls = (Runner as unknown as Mock).mock.calls;
      expect(constructorCalls[0][1]).toBe('step2');
      expect(constructorCalls[1][1]).toBe('step3');

      const completedStatus = readStatusFile(statusPath);
      expect(completedStatus.status).toBe('completed');

      // Checkpoint should be cleaned up after successful completion
      expect(readCheckpointFile(outputDir)).toBeNull();
    });
  });

  describe('signal handler cleanup', () => {
    it('unregisters SIGTERM and SIGINT handlers after successful completion', async () => {
      writeWorkflow();

      const sigtermBefore = process.listenerCount('SIGTERM');
      const sigintBefore = process.listenerCount('SIGINT');

      let callIndex = 0;
      (Runner as unknown as Mock).mockImplementation(() => {
        const results = [
          makeResult('step1', true, {
            outputs: new Map([['result1', 'a']]),
          }),
          makeResult('step2', true, {
            outputs: new Map([['result2', 'b']]),
          }),
          makeResult('step3', true, {
            outputs: new Map([['result3', 'c']]),
          }),
        ];
        const idx = callIndex++;
        const instance = { run: vi.fn().mockResolvedValue(results[idx]) };
        runnerInstances.push(instance);
        return instance;
      });

      await runAndCapture();

      // Signal handlers should be cleaned up — listener count should
      // not exceed what was registered before the run.
      expect(process.listenerCount('SIGTERM')).toBeLessThanOrEqual(
        sigtermBefore
      );
      expect(process.listenerCount('SIGINT')).toBeLessThanOrEqual(sigintBefore);
    });

    it('unregisters SIGTERM and SIGINT handlers after paused exit', async () => {
      writeWorkflow();

      const sigtermBefore = process.listenerCount('SIGTERM');
      const sigintBefore = process.listenerCount('SIGINT');

      let callIndex = 0;
      (Runner as unknown as Mock).mockImplementation(() => {
        const results = [
          makeResult('step1', true, {
            outputs: new Map([['result1', 'a']]),
          }),
          makeResult('step2', false, {
            error: 'credit limit reached',
            outputs: new Map([['error_retryable', 'true']]),
          }),
        ];
        const idx = callIndex++;
        const instance = { run: vi.fn().mockResolvedValue(results[idx]) };
        runnerInstances.push(instance);
        return instance;
      });

      await runAndCapture();

      expect(process.listenerCount('SIGTERM')).toBeLessThanOrEqual(
        sigtermBefore
      );
      expect(process.listenerCount('SIGINT')).toBeLessThanOrEqual(sigintBefore);
    });
  });
});
