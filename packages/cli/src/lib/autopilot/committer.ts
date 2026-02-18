import { useState, useEffect, useRef, useCallback } from 'react';
import { join } from 'node:path';
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  ProjectConfigManager,
  Git,
  getDataDir,
  type ProjectManager,
} from 'rover-core';
import { getUserAIAgent, getAIAgentTool } from '../agents/index.js';
import { AutopilotStore } from './store.js';
import type {
  CommitterStatus,
  ActionTrace,
  PendingAction,
  Span,
  Action,
} from './types.js';

const PROCESS_INTERVAL_MS = 30_000; // 30 seconds
const INITIAL_DELAY_MS = 20_000; // 20 seconds (staggered after workflow runner's 15s)

function getTaskIterationSummaries(iterationsPath: string): string[] {
  try {
    if (!existsSync(iterationsPath)) {
      return [];
    }

    const iterations = readdirSync(iterationsPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => parseInt(dirent.name, 10))
      .filter(num => !Number.isNaN(num))
      .sort((a, b) => a - b);

    const summaries: string[] = [];

    for (const iteration of iterations) {
      const iterationPath = join(iterationsPath, iteration.toString());
      const summaryPath = join(iterationPath, 'summary.md');

      if (existsSync(summaryPath)) {
        try {
          const summary = readFileSync(summaryPath, 'utf8').trim();
          if (summary) {
            summaries.push(`Iteration ${iteration}: ${summary}`);
          }
        } catch {
          // skip unreadable summaries
        }
      }
    }

    return summaries;
  } catch {
    return [];
  }
}

async function generateCommitMessage(
  taskTitle: string,
  taskDescription: string,
  recentCommits: string[],
  summaries: string[]
): Promise<string | null> {
  try {
    const agent = getUserAIAgent();
    const aiAgent = getAIAgentTool(agent);
    const commitMessage = await aiAgent.generateCommitMessage(
      taskTitle,
      taskDescription,
      recentCommits,
      summaries
    );

    if (commitMessage == null || commitMessage.length === 0) {
      return null;
    }

    return commitMessage;
  } catch {
    return null;
  }
}

/**
 * Write the committer's own span — records what the commit step did.
 */
function writeCommitSpan(
  projectId: string,
  summary: string,
  parentSpanId: string,
  meta: Record<string, any>
): { spanId: string } {
  const basePath = join(getDataDir(), 'projects', projectId);
  const spansDir = join(basePath, 'spans');
  mkdirSync(spansDir, { recursive: true });

  const spanId = randomUUID();
  const timestamp = new Date().toISOString();

  const span: Span = {
    id: spanId,
    version: '1.0',
    timestamp,
    summary: `commit: ${summary}`,
    step: 'commit',
    parent: parentSpanId,
    meta,
  };

  writeFileSync(
    join(spansDir, `${spanId}.json`),
    JSON.stringify(span, null, 2)
  );

  return { spanId };
}

/**
 * Write the resolve Action file for the next step in the pipeline.
 * This creates the action on disk so the resolver can read it.
 */
function writeResolveAction(
  projectId: string,
  actionId: string,
  commitSpanId: string,
  meta: Record<string, any>,
  reasoning: string
): void {
  const basePath = join(getDataDir(), 'projects', projectId);
  const actionsDir = join(basePath, 'actions');
  mkdirSync(actionsDir, { recursive: true });

  const action: Action = {
    id: actionId,
    version: '1.0',
    action: 'resolve',
    timestamp: new Date().toISOString(),
    spanId: commitSpanId,
    meta,
    reasoning,
  };

  writeFileSync(
    join(actionsDir, `${actionId}.json`),
    JSON.stringify(action, null, 2)
  );
}

async function processCommitAction(
  pending: PendingAction,
  project: ProjectManager,
  projectPath: string,
  projectId: string,
  store: AutopilotStore
): Promise<{
  committed: boolean;
  taskId: number;
  branchName: string;
  commitError: {
    message: string;
    exitCode: number | null;
    stderr: string;
    command: string;
  } | null;
}> {
  const meta = pending.meta ?? {};
  const sourceActionId = meta.sourceActionId;
  const taskStatus = meta.taskStatus;

  // Look up task via the source action's mapping
  const mapping = store.getTaskMapping(sourceActionId);
  if (!mapping) {
    throw new Error(
      `No task mapping found for source action ${sourceActionId}`
    );
  }

  const { taskId, branchName } = mapping;
  const task = project.getTask(taskId);
  if (!task) {
    throw new Error(`Task #${taskId} not found`);
  }

  // If the task failed, skip committing — pass through to resolver
  if (taskStatus === 'FAILED' || task.status === 'FAILED') {
    const { spanId: commitSpanId } = writeCommitSpan(
      projectId,
      `task #${taskId} failed, skipping commit`,
      pending.spanId,
      {
        roverTaskId: taskId,
        branchName,
        committed: false,
        commitSha: null,
        taskStatus: 'FAILED',
        error: task.error ?? 'unknown error',
      }
    );

    // Write resolve action file to disk and enqueue
    const resolveActionId = randomUUID();
    const resolveMeta = {
      ...meta,
      committed: false,
      taskStatus: 'FAILED',
    };

    writeResolveAction(
      projectId,
      resolveActionId,
      commitSpanId,
      resolveMeta,
      `Resolve task #${taskId}: ${meta.title} (failed)`
    );

    store.addPending({
      traceId: pending.traceId,
      actionId: resolveActionId,
      spanId: commitSpanId,
      action: 'resolve',
      summary: `resolve: ${meta.title}`,
      createdAt: new Date().toISOString(),
      meta: resolveMeta,
    });

    // Remove processed commit action
    store.removePending(pending.actionId);

    // Log
    store.appendLog({
      ts: new Date().toISOString(),
      traceId: pending.traceId,
      spanId: commitSpanId,
      actionId: resolveActionId,
      step: 'commit',
      action: 'resolve',
      summary: `task #${taskId}: ${meta.title} — failed, skipping commit, resolve enqueued`,
    });

    return { committed: false, taskId, branchName, commitError: null };
  }

  // Task completed — check for uncommitted changes
  const git = new Git({ cwd: projectPath });

  let committed = false;
  let commitSha: string | null = null;
  let commitError: {
    message: string;
    exitCode: number | null;
    stderr: string;
    command: string;
  } | null = null;

  try {
    const hasChanges = git.hasUncommittedChanges({
      worktreePath: task.worktreePath,
    });

    if (hasChanges) {
      // Gather iteration summaries for commit message
      const summaries = getTaskIterationSummaries(task.iterationsPath());
      const recentCommits = git.getRecentCommits();

      // Generate AI commit message
      const aiCommitMessage = await generateCommitMessage(
        task.title,
        task.description,
        recentCommits,
        summaries
      );

      let finalCommitMessage = aiCommitMessage || task.title;

      // Add attribution line when enabled
      const projectConfig = ProjectConfigManager.load(projectPath);
      if (projectConfig == null || projectConfig?.attribution === true) {
        finalCommitMessage = `${finalCommitMessage}\n\nCo-Authored-By: Rover <noreply@endor.dev>`;
      }

      // Stage and commit
      git.addAndCommit(finalCommitMessage, {
        worktreePath: task.worktreePath,
      });

      committed = true;
      commitSha = git.getCommitHash('HEAD', {
        worktreePath: task.worktreePath,
      });
    }
  } catch (err) {
    commitError = {
      message: err instanceof Error ? err.message : String(err),
      exitCode: (err as any).exitCode ?? null,
      stderr: (err as any).stderr?.toString() ?? '',
      command: (err as any).command ?? 'git',
    };
  }

  // Write commit span
  const commitSummary = commitError
    ? `task #${taskId}: commit failed`
    : `task #${taskId}: ${committed ? 'committed' : 'no changes'}`;

  const { spanId: commitSpanId } = writeCommitSpan(
    projectId,
    commitSummary,
    pending.spanId,
    {
      roverTaskId: taskId,
      branchName,
      committed,
      commitSha,
      taskStatus: 'COMPLETED',
      ...(commitError ? { commitError } : {}),
    }
  );

  // Write resolve action file to disk and enqueue
  const resolveActionId = randomUUID();
  const resolveMeta = {
    ...meta,
    committed,
    taskStatus: 'COMPLETED',
    ...(commitError ? { commitError } : {}),
  };

  const resolveReasoning = commitError
    ? `Resolve task #${taskId}: ${meta.title} (commit failed: ${commitError.message})`
    : `Resolve task #${taskId}: ${meta.title} (${committed ? 'committed' : 'no changes'})`;

  writeResolveAction(
    projectId,
    resolveActionId,
    commitSpanId,
    resolveMeta,
    resolveReasoning
  );

  store.addPending({
    traceId: pending.traceId,
    actionId: resolveActionId,
    spanId: commitSpanId,
    action: 'resolve',
    summary: `resolve: ${meta.title}`,
    createdAt: new Date().toISOString(),
    meta: resolveMeta,
  });

  // Remove processed commit action
  store.removePending(pending.actionId);

  // Log
  store.appendLog({
    ts: new Date().toISOString(),
    traceId: pending.traceId,
    spanId: commitSpanId,
    actionId: resolveActionId,
    step: 'commit',
    action: 'resolve',
    summary: commitError
      ? `task #${taskId}: ${meta.title} — commit failed: ${commitError.message}, resolve enqueued`
      : `task #${taskId}: ${meta.title} — ${committed ? 'committed' : 'no changes'}, resolve enqueued`,
  });

  return { committed, taskId, branchName, commitError };
}

export function useCommitter(
  project: ProjectManager,
  projectPath: string,
  projectId: string,
  tracesRef: React.MutableRefObject<Map<string, ActionTrace>>,
  onTracesUpdated: () => void
): { status: CommitterStatus; processedCount: number } {
  const [status, setStatus] = useState<CommitterStatus>('idle');
  const [processedCount, setProcessedCount] = useState(0);
  const inProgressRef = useRef<Set<string>>(new Set());
  const storeRef = useRef<AutopilotStore | null>(null);

  if (!storeRef.current) {
    const store = new AutopilotStore(projectId);
    store.ensureDir();
    storeRef.current = store;
  }

  const doProcess = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;

    const pending = store.getPending();
    const commitActions = pending.filter(
      p => p.action === 'commit' && !inProgressRef.current.has(p.actionId)
    );

    if (commitActions.length === 0) return;

    setStatus('processing');

    // Mark as in-progress
    for (const action of commitActions) {
      inProgressRef.current.add(action.actionId);
    }

    const results = await Promise.allSettled(
      commitActions.map(async action => {
        try {
          // Find/create the trace
          const trace = tracesRef.current.get(action.traceId) ?? {
            traceId: action.traceId,
            summary: action.summary,
            steps: [],
            createdAt: action.createdAt,
          };

          // Mark commit step as running
          const existingStep = trace.steps.find(
            s => s.actionId === action.actionId
          );
          if (existingStep) {
            existingStep.status = 'running';
          }
          tracesRef.current.set(action.traceId, trace);
          onTracesUpdated();

          const result = await processCommitAction(
            action,
            project,
            projectPath,
            projectId,
            store
          );

          // Mark commit step as completed
          const step = trace.steps.find(s => s.actionId === action.actionId);
          if (step) {
            step.status = 'completed';
            step.reasoning = result.commitError
              ? `task #${result.taskId} commit failed: ${result.commitError.message}`
              : result.committed
                ? `task #${result.taskId} committed on ${result.branchName}`
                : `task #${result.taskId} no changes`;
          }

          // Add resolve step to trace
          const resolvePending = store
            .getPending()
            .find(p => p.action === 'resolve' && p.traceId === action.traceId);
          if (resolvePending) {
            trace.steps.push({
              actionId: resolvePending.actionId,
              action: 'resolve',
              status: 'pending',
              timestamp: new Date().toISOString(),
              reasoning: action.meta?.title,
            });
          }

          tracesRef.current.set(action.traceId, trace);
          onTracesUpdated();
          setProcessedCount(c => c + 1);
        } catch (err) {
          // Mark step as failed in the trace
          const trace = tracesRef.current.get(action.traceId);
          if (trace) {
            const step = trace.steps.find(s => s.actionId === action.actionId);
            if (step) {
              step.status = 'failed';
              step.reasoning = err instanceof Error ? err.message : String(err);
            }
            tracesRef.current.set(action.traceId, trace);
            onTracesUpdated();
          }

          // Remove from pending on failure
          store.removePending(action.actionId);
        } finally {
          inProgressRef.current.delete(action.actionId);
        }
      })
    );

    const hasError = results.some(r => r.status === 'rejected');
    setStatus(hasError ? 'error' : 'idle');
  }, [project, projectPath, projectId, tracesRef, onTracesUpdated]);

  // Initial delay then periodic processing
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const initialTimer = setTimeout(() => {
      doProcess();
      interval = setInterval(doProcess, PROCESS_INTERVAL_MS);
    }, INITIAL_DELAY_MS);

    return () => {
      clearTimeout(initialTimer);
      if (interval) clearInterval(interval);
    };
  }, [doProcess]);

  return { status, processedCount };
}
