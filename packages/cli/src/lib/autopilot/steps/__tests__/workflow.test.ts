import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let projectDir: string;

const mockTask = {
  id: 1,
  iterations: 1,
  status: 'IN_PROGRESS',
  error: undefined as string | undefined,
  iterationsPath: vi.fn(),
  setWorkspace: vi.fn(),
  markInProgress: vi.fn(),
  resetToNew: vi.fn(),
  setAgentImage: vi.fn(),
  setContainerInfo: vi.fn(),
  updateStatusFromIteration: vi.fn(),
  getIterationPath: vi.fn(),
};

const mockProject = {
  createTask: vi.fn(() => mockTask),
  getWorkspacePath: vi.fn((taskId: number) =>
    join(projectDir, 'workspaces', String(taskId))
  ),
  getTaskIterationLogsPath: vi.fn(() => join(projectDir, 'logs')),
};

vi.mock('rover-core', async () => {
  const actual =
    await vi.importActual<typeof import('rover-core')>('rover-core');
  return {
    ...actual,
    getProjectPath: () => projectDir,
    ProjectConfigManager: {
      load: () => ({
        excludePatterns: undefined,
        agentImage: undefined,
      }),
    },
    IterationManager: {
      createInitial: vi.fn(() => ({
        setContext: vi.fn(),
      })),
    },
    Git: vi.fn().mockImplementation(() => ({
      getMainBranch: () => 'main',
      createWorktree: vi.fn(),
      setupSparseCheckout: vi.fn(),
    })),
    ContextManager: vi.fn().mockImplementation(() => ({
      fetchAndStore: vi.fn().mockResolvedValue([]),
      getContextDir: () => join(projectDir, 'context'),
      readStoredContent: () => '',
    })),
    generateContextIndex: vi.fn(() => '# Context Index'),
    registerBuiltInProviders: vi.fn(),
  };
});

vi.mock('../../../sandbox/index.js', () => ({
  createSandbox: vi.fn().mockResolvedValue({
    createAndStart: vi.fn().mockResolvedValue('mock-container-id'),
  }),
}));

vi.mock('../../../sandbox/container-common.js', () => ({
  resolveAgentImage: vi.fn(() => 'ghcr.io/test/agent:latest'),
}));

vi.mock('../../../agents/index.js', () => ({
  getUserAIAgent: vi.fn(() => 'claude'),
  getAIAgentTool: vi.fn(() => ({
    checkAgent: vi.fn(),
  })),
}));

vi.mock('../../../../utils/branch-name.js', () => ({
  generateBranchName: vi.fn((taskId: number) => `rover/task-${taskId}-abc123`),
}));

vi.mock('../../../../utils/env-files.js', () => ({
  copyEnvironmentFiles: vi.fn(() => true),
}));

import type { ProjectManager } from 'rover-core';
import { AutopilotStore } from '../../store.js';
import type { Action, PendingAction, TraceItem } from '../../types.js';
import { workflowStep } from '../workflow.js';
import type { StepContext } from '../types.js';

function makePending(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    traceId: 'trace-1',
    actionId: 'action-1',
    action: 'workflow',
    ...overrides,
  };
}

function writeActionFile(
  actionId: string,
  overrides: Partial<Action> = {}
): void {
  const data: Action = {
    id: actionId,
    version: '1.0',
    action: 'workflow',
    timestamp: new Date().toISOString(),
    spanId: 'parent-span-1',
    meta: {
      title: 'Fix bug',
      description: 'Fix the login bug',
      _pollIntervalMs: 0,
      _timeoutMs: 500,
    },
    reasoning: 'New workflow task',
    ...overrides,
  };
  writeFileSync(
    join(projectDir, 'actions', `${actionId}.json`),
    JSON.stringify(data)
  );
}

function makeTrace(): TraceItem {
  return {
    traceId: 'trace-1',
    summary: 'Test trace',
    spanIds: [],
    nextActions: ['action-1'],
    createdAt: new Date().toISOString(),
  };
}

function makeContext(store: AutopilotStore): StepContext {
  return {
    store,
    project: {
      id: 'test-project',
      path: projectDir,
      ...mockProject,
    } as unknown as ProjectManager,
    owner: 'test-owner',
    repo: 'test-repo',
    workflowStore: undefined,
    memoryStore: undefined,
    botName: 'rover-bot',
    maintainers: undefined,
    customInstructions: undefined,
    mode: undefined,
    trace: makeTrace(),
    failTrace: vi.fn(),
  };
}

describe('workflowStep', () => {
  let store: AutopilotStore;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'workflow-test-'));
    mkdirSync(join(projectDir, 'spans'), { recursive: true });
    mkdirSync(join(projectDir, 'actions'), { recursive: true });
    mkdirSync(join(projectDir, 'workspaces'), { recursive: true });
    store = new AutopilotStore('test-project');
    store.ensureDir();

    // Reset mock task state
    mockTask.id = 1;
    mockTask.iterations = 1;
    mockTask.status = 'IN_PROGRESS';
    mockTask.error = undefined;
    mockTask.iterationsPath.mockReturnValue(join(projectDir, 'iterations'));
    mockTask.setWorkspace.mockReset();
    mockTask.markInProgress.mockReset();
    mockTask.resetToNew.mockReset();
    mockTask.setAgentImage.mockReset();
    mockTask.setContainerInfo.mockReset();
    mockTask.updateStatusFromIteration.mockReset();

    mockProject.createTask.mockReturnValue(mockTask);

    // By default, the first poll marks task as COMPLETED
    mockTask.updateStatusFromIteration.mockImplementation(() => {
      mockTask.status = 'COMPLETED';
    });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('has correct config', () => {
    expect(workflowStep.config.actionType).toBe('workflow');
    expect(workflowStep.config.maxParallel).toBe(3);
  });

  it('completes successfully and creates a commit action', async () => {
    const pending = makePending();
    writeActionFile('action-1');
    store.addPending(pending);

    const ctx = makeContext(store);
    const result = await workflowStep.process(pending, ctx);

    expect(result.spanId).toBeDefined();
    expect(result.terminal).toBe(false);
    expect(result.newActions).toHaveLength(1);
    expect(result.newActions?.[0].action).toBe('commit');

    // Verify span completed
    const spanData = JSON.parse(
      readFileSync(join(projectDir, 'spans', `${result.spanId}.json`), 'utf8')
    );
    expect(spanData.status).toBe('completed');
    expect(spanData.step).toBe('workflow');

    // Verify task mapping was stored
    const mapping = store.getTaskMapping('action-1');
    expect(mapping).toBeDefined();
    expect(mapping?.taskId).toBe(1);
    expect(mapping?.branchName).toBe('rover/task-1-abc123');
    expect(mapping?.workflowSpanId).toBe(result.spanId);
  });

  it('fails trace when task fails', async () => {
    mockTask.updateStatusFromIteration.mockImplementation(() => {
      mockTask.status = 'FAILED';
      mockTask.error = 'Build failed';
    });

    const pending = makePending();
    writeActionFile('action-1');
    store.addPending(pending);

    const ctx = makeContext(store);
    const result = await workflowStep.process(pending, ctx);

    expect(result.terminal).toBe(true);
    expect(result.newActions).toBeUndefined();
    expect(ctx.failTrace).toHaveBeenCalled();

    const spanData = JSON.parse(
      readFileSync(join(projectDir, 'spans', `${result.spanId}.json`), 'utf8')
    );
    expect(spanData.status).toBe('failed');
    expect(spanData.summary).toContain('failed');
  });

  it('returns pending when running task limit reached', async () => {
    // Create 3 "running" task mappings (with non-terminal spans)
    for (let i = 0; i < 3; i++) {
      const spanId = `running-span-${i}`;
      writeFileSync(
        join(projectDir, 'spans', `${spanId}.json`),
        JSON.stringify({
          id: spanId,
          status: 'running',
          step: 'workflow',
          parent: null,
          completed: null,
          summary: null,
          meta: {},
          originAction: null,
          newActions: [],
        })
      );
      store.setTaskMapping(`existing-action-${i}`, {
        taskId: i + 10,
        branchName: `rover/task-${i + 10}-xyz`,
        traceId: `trace-${i}`,
        workflowSpanId: spanId,
      });
    }

    const pending = makePending();
    writeActionFile('action-1');

    const ctx = makeContext(store);
    const result = await workflowStep.process(pending, ctx);

    expect(result.status).toBe('pending');
  });

  it('returns pending when dependency not yet processed', async () => {
    const pending = makePending();
    writeActionFile('action-1', {
      meta: {
        title: 'Fix bug',
        depends_on_action_id: 'dep-action-1',
        _pollIntervalMs: 0,
        _timeoutMs: 500,
      },
    });

    const ctx = makeContext(store);
    const result = await workflowStep.process(pending, ctx);

    expect(result.status).toBe('pending');
  });

  it('terminates when dependency failed', async () => {
    // Write a failed span for the dependency
    const depSpanId = 'dep-span-failed';
    writeFileSync(
      join(projectDir, 'spans', `${depSpanId}.json`),
      JSON.stringify({
        id: depSpanId,
        status: 'failed',
        step: 'workflow',
        parent: null,
        completed: new Date().toISOString(),
        summary: 'Dependency task failed',
        meta: {},
        originAction: null,
        newActions: [],
      })
    );
    store.setTaskMapping('dep-action-1', {
      taskId: 99,
      branchName: 'rover/task-99-xyz',
      traceId: 'trace-dep',
      workflowSpanId: depSpanId,
    });

    const pending = makePending();
    writeActionFile('action-1', {
      meta: {
        title: 'Fix bug',
        depends_on_action_id: 'dep-action-1',
        _pollIntervalMs: 0,
        _timeoutMs: 500,
      },
    });

    const ctx = makeContext(store);
    const result = await workflowStep.process(pending, ctx);

    expect(result.terminal).toBe(true);
    expect(ctx.failTrace).toHaveBeenCalled();

    const spanData = JSON.parse(
      readFileSync(join(projectDir, 'spans', `${result.spanId}.json`), 'utf8')
    );
    expect(spanData.status).toBe('error');
    expect(spanData.summary).toContain('Dependency');
  });

  it('uses dependency branch as base when dependency completed', async () => {
    const depSpanId = 'dep-span-ok';
    writeFileSync(
      join(projectDir, 'spans', `${depSpanId}.json`),
      JSON.stringify({
        id: depSpanId,
        status: 'completed',
        step: 'workflow',
        parent: null,
        completed: new Date().toISOString(),
        summary: 'Done',
        meta: {},
        originAction: null,
        newActions: [],
      })
    );
    store.setTaskMapping('dep-action-1', {
      taskId: 50,
      branchName: 'rover/task-50-dep',
      traceId: 'trace-dep',
      workflowSpanId: depSpanId,
    });

    const pending = makePending();
    writeActionFile('action-1', {
      meta: {
        title: 'Continue work',
        depends_on_action_id: 'dep-action-1',
        _pollIntervalMs: 0,
        _timeoutMs: 500,
      },
    });

    const { Git } = await import('rover-core');
    const mockCreateWorktree = vi.fn();
    vi.mocked(Git).mockImplementationOnce(
      () =>
        ({
          getMainBranch: () => 'main',
          createWorktree: mockCreateWorktree,
          setupSparseCheckout: vi.fn(),
        }) as unknown as InstanceType<typeof Git>
    );

    const ctx = makeContext(store);
    await workflowStep.process(pending, ctx);

    // The worktree should have been created with the dependency branch
    expect(mockCreateWorktree).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('rover/task-'),
      'rover/task-50-dep'
    );
  });

  it('resets task on sandbox creation failure', async () => {
    const { createSandbox } = await import('../../../sandbox/index.js');
    vi.mocked(createSandbox).mockRejectedValueOnce(
      new Error('Docker not available')
    );

    const pending = makePending();
    writeActionFile('action-1');

    const ctx = makeContext(store);
    await expect(workflowStep.process(pending, ctx)).rejects.toThrow(
      'Docker not available'
    );

    expect(mockTask.resetToNew).toHaveBeenCalled();

    // Span should be marked as error
    const spanFiles = require('node:fs').readdirSync(
      join(projectDir, 'spans')
    ) as string[];
    const workflowSpans = spanFiles.filter((f: string) => f.endsWith('.json'));
    expect(workflowSpans.length).toBeGreaterThan(0);

    // Find the workflow span (not parent-span-1)
    for (const file of workflowSpans) {
      const data = JSON.parse(
        readFileSync(join(projectDir, 'spans', file), 'utf8')
      );
      if (data.step === 'workflow') {
        expect(data.status).toBe('error');
        expect(data.summary).toContain('Docker not available');
      }
    }
  });

  it('times out and terminates the trace', async () => {
    // Task stays IN_PROGRESS forever
    mockTask.updateStatusFromIteration.mockImplementation(() => {
      mockTask.status = 'IN_PROGRESS';
    });

    const pending = makePending();
    writeActionFile('action-1', {
      meta: {
        title: 'Fix bug',
        _pollIntervalMs: 0,
        _timeoutMs: 50, // Very short timeout for test
      },
    });

    const ctx = makeContext(store);
    const result = await workflowStep.process(pending, ctx);

    expect(result.terminal).toBe(true);
    expect(ctx.failTrace).toHaveBeenCalled();

    const spanData = JSON.parse(
      readFileSync(join(projectDir, 'spans', `${result.spanId}.json`), 'utf8')
    );
    expect(spanData.status).toBe('error');
    expect(spanData.summary).toContain('timed out');
  });

  it('handles context injection failure silently', async () => {
    const { ContextManager } = await import('rover-core');
    vi.mocked(ContextManager).mockImplementationOnce(
      () =>
        ({
          fetchAndStore: vi.fn().mockRejectedValue(new Error('fetch failed')),
          getContextDir: () => join(projectDir, 'context'),
        }) as unknown as InstanceType<typeof ContextManager>
    );

    const pending = makePending();
    writeActionFile('action-1', {
      meta: {
        title: 'Task with context',
        context_uris: ['github://owner/repo#1'],
        _pollIntervalMs: 0,
        _timeoutMs: 500,
      },
    });

    const ctx = makeContext(store);
    // Should not throw — context failure is best-effort
    const result = await workflowStep.process(pending, ctx);

    expect(result.spanId).toBeDefined();
    expect(result.terminal).toBe(false);
    expect(result.newActions).toHaveLength(1);
  });
});
