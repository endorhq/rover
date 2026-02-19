import { useState, useEffect, useRef, useCallback } from 'react';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  ProjectConfigManager,
  IterationManager,
  Git,
  type ProjectManager,
} from 'rover-core';
import { getUserAIAgent } from '../agents/index.js';
import { createSandbox } from '../sandbox/index.js';
import { resolveAgentImage } from '../sandbox/container-common.js';
import { generateBranchName } from '../../utils/branch-name.js';
import { copyEnvironmentFiles } from '../../utils/env-files.js';
import { AutopilotStore } from './store.js';
import { SpanWriter, ActionWriter, enqueueAction } from './logging.js';
import type {
  WorkflowRunnerStatus,
  ActionTrace,
  ActionStep,
  PendingAction,
} from './types.js';

const PROCESS_INTERVAL_MS = 30_000; // 30 seconds
const INITIAL_DELAY_MS = 15_000; // 15 seconds (after planner's 10s)
const MAX_RUNNING_TASKS = 3;

function enqueueCommitAction(
  projectId: string,
  pending: PendingAction,
  roverTaskId: number,
  branchName: string,
  workflowSpanId: string,
  taskStatus: string,
  store: AutopilotStore
): { commitActionId: string; commitSpanId: string } {
  const commitMeta = {
    roverTaskId,
    workflow: pending.meta?.workflow,
    title: pending.meta?.title,
    branchName,
    sourceActionId: pending.actionId,
    taskStatus,
  };

  // Commit span — created and completed immediately (it just records intent)
  const span = new SpanWriter(projectId, {
    step: 'commit',
    parentId: workflowSpanId,
    meta: commitMeta,
  });
  span.complete(`commit: ${pending.meta?.title}`);

  // Commit action — tells the committer to run git operations
  const action = new ActionWriter(projectId, {
    action: 'commit',
    spanId: span.id,
    reasoning: `Commit task #${roverTaskId}: ${pending.meta?.title}`,
    meta: commitMeta,
  });

  enqueueAction(store, {
    traceId: pending.traceId,
    action,
    step: 'workflow',
    summary: `commit: ${pending.meta?.title}`,
  });

  return { commitActionId: action.id, commitSpanId: span.id };
}

async function processWorkflowAction(
  pending: PendingAction,
  project: ProjectManager,
  projectPath: string,
  projectId: string,
  store: AutopilotStore
): Promise<{
  roverTaskId: number;
  branchName: string;
  containerId: string;
  workflowSpanId: string;
}> {
  const git = new Git({ cwd: projectPath });
  const meta = pending.meta ?? {};

  // 1. Resolve source branch (branch traceing for dependencies)
  let baseBranch: string;
  if (meta.depends_on_action_id) {
    const depMapping = store.getTaskMapping(meta.depends_on_action_id);
    if (depMapping) {
      baseBranch = depMapping.branchName;
    } else {
      baseBranch = git.getCurrentBranch();
    }
  } else {
    baseBranch = git.getCurrentBranch();
  }

  // 2. Create Rover task
  const selectedAgent = getUserAIAgent();
  const task = project.createTask({
    title: meta.title ?? pending.summary,
    description: meta.description ?? pending.summary,
    inputs: new Map([['description', meta.description ?? pending.summary]]),
    workflowName: meta.workflow ?? 'swe',
    agent: selectedAgent,
    sourceBranch: baseBranch,
  });

  const taskId = task.id;

  // 3. Setup git worktree
  const worktreePath = project.getWorkspacePath(taskId);
  const branchName = generateBranchName(taskId);

  git.createWorktree(worktreePath, branchName, baseBranch);

  // Capture base commit
  const baseCommit = git.getCommitHash('HEAD', { worktreePath });
  if (baseCommit) {
    task.setBaseCommit(baseCommit);
  }

  // Copy env files
  copyEnvironmentFiles(projectPath, worktreePath);

  // Setup sparse checkout if configured
  const projectConfig = ProjectConfigManager.load(projectPath);
  if (
    projectConfig.excludePatterns &&
    projectConfig.excludePatterns.length > 0
  ) {
    git.setupSparseCheckout(worktreePath, projectConfig.excludePatterns);
  }

  // 4. Create initial iteration
  const iterationPath = join(task.iterationsPath(), task.iterations.toString());
  mkdirSync(iterationPath, { recursive: true });

  IterationManager.createInitial(
    iterationPath,
    task.id,
    meta.title ?? pending.summary,
    meta.description ?? pending.summary
  );

  task.setWorkspace(worktreePath, branchName);
  task.markInProgress();

  // 5. Resolve agent image and start sandbox
  const agentImage = resolveAgentImage(projectConfig);
  task.setAgentImage(agentImage);

  let containerId = '';
  let sandboxError: string | undefined;
  try {
    const sandbox = await createSandbox(task, undefined, {
      projectPath,
      verbose: true,
    });
    containerId = await sandbox.createAndStart();

    const sandboxMetadata = process.env.DOCKER_HOST
      ? { dockerHost: process.env.DOCKER_HOST }
      : undefined;

    task.setContainerInfo(containerId, 'running', sandboxMetadata);
  } catch (err) {
    sandboxError = err instanceof Error ? err.message : String(err);
    task.resetToNew();
  }

  // 6. Write workflow execution span (stays running — monitor phase will complete it)
  const workflowSpan = new SpanWriter(projectId, {
    step: 'workflow',
    parentId: pending.spanId,
    meta: {
      roverTaskId: taskId,
      branchName,
      worktreePath,
      containerId,
      workflow: meta.workflow,
      title: meta.title,
      baseBranch,
      ...(sandboxError ? { sandboxError } : {}),
    },
  });

  // 7. Store actionId → task mapping (with trace context for monitor phase)
  store.setTaskMapping(pending.actionId, {
    taskId,
    branchName,
    traceId: pending.traceId,
    workflowSpanId: workflowSpan.id,
  });

  // 8. Remove processed workflow action from pending
  store.removePending(pending.actionId);

  // 9. Write log entry
  store.appendLog({
    ts: new Date().toISOString(),
    traceId: pending.traceId,
    spanId: workflowSpan.id,
    actionId: pending.actionId,
    step: 'workflow',
    action: 'workflow',
    summary: `task #${taskId}: ${meta.title} (branch: ${branchName}) — launched`,
  });

  return {
    roverTaskId: taskId,
    branchName,
    containerId,
    workflowSpanId: workflowSpan.id,
  };
}

export function useWorkflowRunner(
  project: ProjectManager,
  projectPath: string,
  projectId: string,
  tracesRef: React.MutableRefObject<Map<string, ActionTrace>>,
  onTracesUpdated: () => void
): {
  status: WorkflowRunnerStatus;
  processedCount: number;
} {
  const [status, setStatus] = useState<WorkflowRunnerStatus>('idle');
  const [processedCount, setProcessedCount] = useState(0);
  const inProgressRef = useRef<Set<string>>(new Set());
  const storeRef = useRef<AutopilotStore | null>(null);

  if (!storeRef.current) {
    const store = new AutopilotStore(projectId);
    store.ensureDir();
    storeRef.current = store;
  }

  // Phase 2: Monitor running tasks and create review/error actions on completion
  const monitorRunningTasks = useCallback(
    (store: AutopilotStore) => {
      const mappings = store.getAllTaskMappings();
      let updated = false;

      for (const [actionId, mapping] of Object.entries(mappings)) {
        // Skip legacy mappings without trace context (pre-two-phase)
        if (!mapping.traceId) continue;

        const trace = tracesRef.current.get(mapping.traceId);
        if (!trace) continue;

        const step = trace.steps.find(s => s.actionId === actionId);
        if (!step || step.status !== 'running') continue;

        // Step is still running — check actual task status
        const task = project.getTask(mapping.taskId);
        if (!task) continue;

        const taskStatus = task.status;

        if (taskStatus === 'COMPLETED') {
          const pendingForCommit: PendingAction = {
            traceId: mapping.traceId,
            actionId,
            spanId: mapping.workflowSpanId!,
            action: 'workflow',
            summary: step.reasoning ?? '',
            createdAt: step.timestamp,
            meta: {
              workflow: step.action,
              title: task.title,
              description: task.description,
            },
          };

          // Task completed — enqueue commit action
          const { commitActionId } = enqueueCommitAction(
            projectId,
            pendingForCommit,
            mapping.taskId,
            mapping.branchName,
            mapping.workflowSpanId!,
            'COMPLETED',
            store
          );

          // Mark workflow step as completed
          step.status = 'completed';
          step.reasoning = `task #${mapping.taskId} on ${mapping.branchName}`;

          // Add commit step to trace
          trace.steps.push({
            actionId: commitActionId,
            action: 'commit',
            status: 'pending',
            timestamp: new Date().toISOString(),
            reasoning: task.title,
          });

          tracesRef.current.set(mapping.traceId, trace);

          updated = true;
          setProcessedCount(c => c + 1);
        } else if (taskStatus === 'FAILED') {
          const errorMessage = task.error ?? 'unknown error';
          const pendingForCommit: PendingAction = {
            traceId: mapping.traceId,
            actionId,
            spanId: mapping.workflowSpanId!,
            action: 'workflow',
            summary: step.reasoning ?? '',
            createdAt: step.timestamp,
            meta: {
              workflow: step.action,
              title: task.title,
              description: task.description,
            },
          };

          // Task failed — enqueue commit action so committer/resolver can handle it
          const { commitActionId } = enqueueCommitAction(
            projectId,
            pendingForCommit,
            mapping.taskId,
            mapping.branchName,
            mapping.workflowSpanId!,
            'FAILED',
            store
          );

          // Mark workflow step as failed
          step.status = 'failed';
          step.reasoning = errorMessage;

          // Add commit step to trace (committer will detect failed status)
          trace.steps.push({
            actionId: commitActionId,
            action: 'commit',
            status: 'pending',
            timestamp: new Date().toISOString(),
            reasoning: `${task.title} (failed: ${errorMessage})`,
          });

          tracesRef.current.set(mapping.traceId, trace);

          updated = true;
        }
        // Otherwise (IN_PROGRESS, ITERATING, NEW) — skip, check next cycle
      }

      if (updated) {
        onTracesUpdated();
      }
    },
    [project, projectId, tracesRef, onTracesUpdated]
  );

  const doProcess = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;

    // === Phase 2: Monitor running tasks for completion ===
    monitorRunningTasks(store);

    // === Phase 1: Launch new tasks ===

    // 1. Get all pending 'workflow' actions not already in-progress
    const pending = store.getPending();
    const workflowActions = pending.filter(
      p => p.action === 'workflow' && !inProgressRef.current.has(p.actionId)
    );

    if (workflowActions.length === 0) return;

    setStatus('processing');

    // 2. Count running Rover tasks
    const allTasks = project.listTasks();
    const runningCount = allTasks.filter(t =>
      ['IN_PROGRESS', 'ITERATING'].includes(t.status)
    ).length;

    // 3. Available slots
    const availableSlots = MAX_RUNNING_TASKS - runningCount;
    if (availableSlots <= 0) {
      setStatus('idle');
      return;
    }

    // 4. Filter eligible actions (dependency resolution)
    const eligible: PendingAction[] = [];
    for (const action of workflowActions) {
      const depActionId = action.meta?.depends_on_action_id;

      if (!depActionId) {
        // No dependency — eligible immediately
        eligible.push(action);
        continue;
      }

      // Has dependency — check if it's been processed
      const mapping = store.getTaskMapping(depActionId);
      if (!mapping) {
        // Dependency hasn't been processed yet — skip
        continue;
      }

      // Dependency was processed — check its task status
      const depTask = project.getTask(mapping.taskId);
      if (!depTask) {
        continue;
      }

      const depStatus = depTask.status;
      if (depStatus === 'COMPLETED') {
        // Dependency completed — eligible (will use mapping.branchName as source)
        eligible.push(action);
      } else if (depStatus === 'FAILED') {
        // Dependency failed — mark this action as failed, remove from pending
        store.removePending(action.actionId);

        const trace = tracesRef.current.get(action.traceId);
        if (trace) {
          const step = trace.steps.find(s => s.actionId === action.actionId);
          if (step) {
            step.status = 'failed';
            step.reasoning = 'dependency failed';
          }
          tracesRef.current.set(action.traceId, trace);
          onTracesUpdated();
        }
      }
      // Otherwise (IN_PROGRESS, ITERATING, etc.) — skip, wait for next cycle
    }

    if (eligible.length === 0) {
      setStatus('idle');
      return;
    }

    // 5. Process min(availableSlots, eligible.length) actions
    const batch = eligible.slice(0, availableSlots);

    // Mark as in-progress
    for (const action of batch) {
      inProgressRef.current.add(action.actionId);
    }

    const results = await Promise.allSettled(
      batch.map(async action => {
        try {
          // Find/create the trace
          const trace = tracesRef.current.get(action.traceId) ?? {
            traceId: action.traceId,
            summary: action.summary,
            steps: [],
            createdAt: action.createdAt,
          };

          // Mark workflow step as running
          const existingStep = trace.steps.find(
            s => s.actionId === action.actionId
          );
          if (existingStep) {
            existingStep.status = 'running';
          } else {
            const runningStep: ActionStep = {
              actionId: action.actionId,
              action: action.meta?.workflow ?? 'workflow',
              status: 'running',
              timestamp: new Date().toISOString(),
            };
            trace.steps.push(runningStep);
          }
          tracesRef.current.set(action.traceId, trace);
          onTracesUpdated();

          const result = await processWorkflowAction(
            action,
            project,
            projectPath,
            projectId,
            store
          );

          // Step stays 'running' — monitor phase will resolve it on task completion
          const step = trace.steps.find(s => s.actionId === action.actionId);
          if (step) {
            step.reasoning = `task #${result.roverTaskId} on ${result.branchName}`;
          }

          tracesRef.current.set(action.traceId, trace);
          onTracesUpdated();
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          const errorStack = err instanceof Error ? (err.stack ?? '') : '';

          // Write error span — workflow step that errored out
          const errorSpan = new SpanWriter(projectId, {
            step: 'workflow',
            parentId: action.spanId,
            meta: { error: errorMessage, stack: errorStack },
          });
          errorSpan.error(`error: ${action.meta?.title ?? action.summary}`);

          // Write error log entry
          store.appendLog({
            ts: new Date().toISOString(),
            traceId: action.traceId,
            spanId: errorSpan.id,
            actionId: action.actionId,
            step: 'workflow',
            action: 'error',
            summary: `error: ${errorMessage}`,
          });

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

    // Check if any failed
    const hasError = results.some(r => r.status === 'rejected');
    setStatus(hasError ? 'error' : 'idle');
  }, [
    project,
    projectPath,
    projectId,
    tracesRef,
    onTracesUpdated,
    monitorRunningTasks,
  ]);

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
