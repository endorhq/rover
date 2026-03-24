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
  status: 'COMPLETED' as string,
  error: undefined as string | undefined,
  worktreePath: '',
  getPreviousIterationArtifacts: vi.fn(() => ({ summaries: [], plans: [] })),
};

vi.mock('rover-core', async () => {
  const actual =
    await vi.importActual<typeof import('rover-core')>('rover-core');
  return {
    ...actual,
    getProjectPath: () => projectDir,
    ProjectConfigManager: {
      load: () => ({
        attribution: true,
      }),
    },
    Git: vi.fn().mockImplementation(() => ({
      hasUncommittedChanges: vi.fn(() => true),
      getRecentCommits: vi.fn(() => [
        'fix: initial commit',
        'feat: add feature',
      ]),
    })),
  };
});

const mockInvoke = vi.fn().mockResolvedValue({
  response: JSON.stringify({
    status: 'committed',
    commit_sha: 'abc123def456',
    commit_message: 'feat: implement login flow',
    error: null,
    recovery_actions_taken: [],
    summary: 'Committed changes for login flow',
  }),
  usage: { inputTokens: 100, outputTokens: 50 },
});

vi.mock('@endorhq/agent', () => ({
  ACPProvider: {
    fromProject: vi.fn(() => ({
      invoke: mockInvoke,
    })),
  },
  parseJsonResponse: vi.fn((text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }),
}));

vi.mock('rover-prompts', () => ({
  commitPromptTemplate: 'You are a committer agent. {{CUSTOM_INSTRUCTIONS}}',
}));

import type { ProjectManager } from 'rover-core';
import { AutopilotStore } from '../../store.js';
import type { Action, PendingAction, TraceItem } from '../../types.js';
import { committerStep } from '../committer.js';
import type { StepContext } from '../types.js';

function makePending(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    traceId: 'trace-1',
    actionId: 'action-1',
    action: 'commit',
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
    action: 'commit',
    timestamp: new Date().toISOString(),
    spanId: 'parent-span-1',
    meta: {
      taskId: 1,
      branchName: 'rover/task-1-abc123',
      title: 'Fix login bug',
      description: 'Fix the login flow authentication issue',
    },
    reasoning: 'Task completed, ready to commit',
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
      getTask: vi.fn(() => mockTask),
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

describe('committerStep', () => {
  let store: AutopilotStore;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'committer-test-'));
    mkdirSync(join(projectDir, 'spans'), { recursive: true });
    mkdirSync(join(projectDir, 'actions'), { recursive: true });
    store = new AutopilotStore('test-project');
    store.ensureDir();

    // Reset mock task state
    mockTask.id = 1;
    mockTask.status = 'COMPLETED';
    mockTask.error = undefined;
    mockTask.worktreePath = join(projectDir, 'worktrees', 'task-1');
    mockTask.getPreviousIterationArtifacts.mockReturnValue({
      summaries: [],
      plans: [],
    });

    // Reset invoke mock
    mockInvoke.mockResolvedValue({
      response: JSON.stringify({
        status: 'committed',
        commit_sha: 'abc123def456',
        commit_message: 'feat: implement login flow',
        error: null,
        recovery_actions_taken: [],
        summary: 'Committed changes for login flow',
      }),
      usage: { inputTokens: 100, outputTokens: 50 },
    });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('has correct config', () => {
    expect(committerStep.config.actionType).toBe('commit');
    expect(committerStep.config.maxParallel).toBe(3);
  });

  it('commits successfully and creates resolve action', async () => {
    const pending = makePending();
    writeActionFile('action-1');
    store.addPending(pending);

    const ctx = makeContext(store);
    const result = await committerStep.process(pending, ctx);

    expect(result.spanId).toBeDefined();
    expect(result.terminal).toBe(false);
    expect(result.newActions).toHaveLength(1);
    expect(result.newActions?.[0].action).toBe('resolve');

    // Verify span completed
    const spanData = JSON.parse(
      readFileSync(join(projectDir, 'spans', `${result.spanId}.json`), 'utf8')
    );
    expect(spanData.status).toBe('completed');
    expect(spanData.step).toBe('commit');
  });

  it('skips commit when task failed', async () => {
    mockTask.status = 'FAILED';

    const pending = makePending();
    writeActionFile('action-1');
    store.addPending(pending);

    const ctx = makeContext(store);
    const result = await committerStep.process(pending, ctx);

    expect(result.terminal).toBe(false);
    expect(result.newActions).toHaveLength(1);
    expect(result.newActions?.[0].action).toBe('resolve');

    const spanData = JSON.parse(
      readFileSync(join(projectDir, 'spans', `${result.spanId}.json`), 'utf8')
    );
    expect(spanData.status).toBe('failed');

    // Verify resolve action has committed: false
    const resolveActionId = result.newActions?.[0].actionId;
    const resolveData = JSON.parse(
      readFileSync(
        join(projectDir, 'actions', `${resolveActionId}.json`),
        'utf8'
      )
    );
    expect(resolveData.meta.committed).toBe(false);
    expect(resolveData.meta.taskStatus).toBe('FAILED');
  });

  it('skips commit when no changes in worktree', async () => {
    const { Git } = await import('rover-core');
    vi.mocked(Git).mockImplementationOnce(
      () =>
        ({
          hasUncommittedChanges: vi.fn(() => false),
          getRecentCommits: vi.fn(() => []),
        }) as unknown as InstanceType<typeof Git>
    );

    const pending = makePending();
    writeActionFile('action-1');
    store.addPending(pending);

    const ctx = makeContext(store);
    const result = await committerStep.process(pending, ctx);

    expect(result.terminal).toBe(false);
    expect(result.newActions).toHaveLength(1);
    expect(result.newActions?.[0].action).toBe('resolve');

    const spanData = JSON.parse(
      readFileSync(join(projectDir, 'spans', `${result.spanId}.json`), 'utf8')
    );
    expect(spanData.status).toBe('completed');
    expect(spanData.summary).toContain('no changes');

    const resolveActionId = result.newActions?.[0].actionId;
    const resolveData = JSON.parse(
      readFileSync(
        join(projectDir, 'actions', `${resolveActionId}.json`),
        'utf8'
      )
    );
    expect(resolveData.meta.committed).toBe(false);
    expect(resolveData.meta.taskStatus).toBe('COMPLETED');
  });

  it('handles AI parse failure', async () => {
    mockInvoke.mockResolvedValueOnce({
      response: 'not valid json at all',
      usage: undefined,
    });

    const { parseJsonResponse } = await import('@endorhq/agent');
    vi.mocked(parseJsonResponse).mockReturnValueOnce(null);

    const pending = makePending();
    writeActionFile('action-1');
    store.addPending(pending);

    const ctx = makeContext(store);
    const result = await committerStep.process(pending, ctx);

    expect(result.terminal).toBe(true);
    expect(ctx.failTrace).toHaveBeenCalled();

    const spanData = JSON.parse(
      readFileSync(join(projectDir, 'spans', `${result.spanId}.json`), 'utf8')
    );
    expect(spanData.status).toBe('failed');
  });

  it('handles AI reporting commit failure', async () => {
    mockInvoke.mockResolvedValueOnce({
      response: JSON.stringify({
        status: 'failed',
        commit_sha: null,
        commit_message: null,
        error: 'Pre-commit hook failed after 3 retries',
        recovery_actions_taken: ['npm install', 'npx prettier --write .'],
        summary: 'Commit failed due to persistent hook errors',
      }),
      usage: { inputTokens: 200, outputTokens: 100 },
    });

    const pending = makePending();
    writeActionFile('action-1');
    store.addPending(pending);

    const ctx = makeContext(store);
    const result = await committerStep.process(pending, ctx);

    expect(result.terminal).toBe(false);
    expect(result.newActions).toHaveLength(1);
    expect(result.newActions?.[0].action).toBe('resolve');

    const spanData = JSON.parse(
      readFileSync(join(projectDir, 'spans', `${result.spanId}.json`), 'utf8')
    );
    expect(spanData.status).toBe('error');

    const resolveActionId = result.newActions?.[0].actionId;
    const resolveData = JSON.parse(
      readFileSync(
        join(projectDir, 'actions', `${resolveActionId}.json`),
        'utf8'
      )
    );
    expect(resolveData.meta.committed).toBe(false);
    expect(resolveData.meta.commitError).toBe(
      'Pre-commit hook failed after 3 retries'
    );
  });

  it('forwards usage metrics', async () => {
    const pending = makePending();
    writeActionFile('action-1');
    store.addPending(pending);

    const ctx = makeContext(store);
    const result = await committerStep.process(pending, ctx);

    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it('throws on missing task', async () => {
    const pending = makePending();
    writeActionFile('action-1');
    store.addPending(pending);

    const ctx = makeContext(store);
    (ctx.project.getTask as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      undefined
    );

    await expect(committerStep.process(pending, ctx)).rejects.toThrow(
      'Task 1 not found'
    );
  });
});
