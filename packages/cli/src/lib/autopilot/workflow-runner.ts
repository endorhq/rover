import { useState, useEffect, useRef, useCallback } from 'react';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  ProjectConfigManager,
  IterationManager,
  Git,
  getDataDir,
  type ProjectManager,
} from 'rover-core';
import { getUserAIAgent } from '../agents/index.js';
import { createSandbox } from '../sandbox/index.js';
import { resolveAgentImage } from '../sandbox/container-common.js';
import { generateBranchName } from '../../utils/branch-name.js';
import { copyEnvironmentFiles } from '../../utils/env-files.js';
import { AutopilotStore } from './store.js';
import type {
  WorkflowRunnerStatus,
  ActionChain,
  ActionStep,
  PendingAction,
  Trace,
  Action,
} from './types.js';

const PROCESS_INTERVAL_MS = 30_000; // 30 seconds
const INITIAL_DELAY_MS = 15_000; // 15 seconds (after planner's 10s)
const MAX_RUNNING_TASKS = 3;

function writeWorkflowTrace(
  projectId: string,
  summary: string,
  parentTraceId: string,
  meta: Record<string, any>
): { traceId: string; actionId: string } {
  const basePath = join(getDataDir(), 'projects', projectId);
  const tracesDir = join(basePath, 'traces');
  const actionsDir = join(basePath, 'actions');

  mkdirSync(tracesDir, { recursive: true });
  mkdirSync(actionsDir, { recursive: true });

  const traceId = randomUUID();
  const actionId = randomUUID();
  const timestamp = new Date().toISOString();

  const trace: Trace = {
    id: traceId,
    version: '1.0',
    timestamp,
    summary: `workflow: ${summary}`,
    step: 'workflow',
    parent: parentTraceId,
    meta,
  };

  const action: Action = {
    id: actionId,
    version: '1.0',
    action: 'workflow',
    timestamp,
    traceId,
    meta,
    reasoning: summary,
  };

  writeFileSync(
    join(tracesDir, `${traceId}.json`),
    JSON.stringify(trace, null, 2)
  );
  writeFileSync(
    join(actionsDir, `${actionId}.json`),
    JSON.stringify(action, null, 2)
  );

  return { traceId, actionId };
}

function writeReviewAction(
  projectId: string,
  pending: PendingAction,
  roverTaskId: number,
  branchName: string,
  workflowTraceId: string,
  store: AutopilotStore
): { reviewActionId: string; reviewTraceId: string } {
  const basePath = join(getDataDir(), 'projects', projectId);
  const actionsDir = join(basePath, 'actions');
  const tracesDir = join(basePath, 'traces');

  mkdirSync(actionsDir, { recursive: true });
  mkdirSync(tracesDir, { recursive: true });

  const reviewActionId = randomUUID();
  const reviewTraceId = randomUUID();
  const timestamp = new Date().toISOString();

  const reviewMeta = {
    roverTaskId,
    workflow: pending.meta?.workflow,
    title: pending.meta?.title,
    branchName,
    sourceActionId: pending.actionId,
  };

  // Write review trace
  const trace: Trace = {
    id: reviewTraceId,
    version: '1.0',
    timestamp,
    summary: `review: ${pending.meta?.title}`,
    step: 'review',
    parent: workflowTraceId,
    meta: reviewMeta,
  };

  writeFileSync(
    join(tracesDir, `${reviewTraceId}.json`),
    JSON.stringify(trace, null, 2)
  );

  // Write review action file
  const action: Action = {
    id: reviewActionId,
    version: '1.0',
    action: 'review',
    timestamp,
    traceId: reviewTraceId,
    meta: reviewMeta,
    reasoning: `Review task #${roverTaskId}: ${pending.meta?.title}`,
  };

  writeFileSync(
    join(actionsDir, `${reviewActionId}.json`),
    JSON.stringify(action, null, 2)
  );

  // Enqueue review pending action
  store.addPending({
    chainId: pending.chainId,
    actionId: reviewActionId,
    traceId: reviewTraceId,
    action: 'review',
    summary: `review: ${pending.meta?.title}`,
    createdAt: timestamp,
    meta: reviewMeta,
  });

  return { reviewActionId, reviewTraceId };
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
  reviewActionId: string;
  reviewTraceId: string;
}> {
  const git = new Git({ cwd: projectPath });
  const meta = pending.meta ?? {};

  // 1. Resolve source branch (branch chaining for dependencies)
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
    inputs: new Map(),
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
  try {
    const sandbox = await createSandbox(task, undefined, { projectPath });
    containerId = await sandbox.createAndStart();

    const sandboxMetadata = process.env.DOCKER_HOST
      ? { dockerHost: process.env.DOCKER_HOST }
      : undefined;

    task.setContainerInfo(containerId, 'running', sandboxMetadata);
  } catch {
    // On sandbox failure: reset task but still proceed with trace/review
    task.resetToNew();
  }

  // 6. Write workflow execution trace
  const { traceId: workflowTraceId } = writeWorkflowTrace(
    projectId,
    `${meta.workflow}: ${meta.title}`,
    pending.traceId,
    {
      roverTaskId: taskId,
      branchName,
      worktreePath,
      containerId,
      workflow: meta.workflow,
      title: meta.title,
      baseBranch,
    }
  );

  // 7. Write review action and enqueue review pending action
  const { reviewActionId, reviewTraceId } = writeReviewAction(
    projectId,
    pending,
    taskId,
    branchName,
    workflowTraceId,
    store
  );

  // 8. Store actionId → task mapping for dependency resolution
  store.setTaskMapping(pending.actionId, { taskId, branchName });

  // 9. Remove processed workflow action from pending
  store.removePending(pending.actionId);

  // 10. Write log entry
  store.appendLog({
    ts: new Date().toISOString(),
    chainId: pending.chainId,
    traceId: workflowTraceId,
    actionId: pending.actionId,
    step: 'workflow',
    action: 'workflow',
    summary: `task #${taskId}: ${meta.title} (branch: ${branchName})`,
  });

  return {
    roverTaskId: taskId,
    branchName,
    containerId,
    reviewActionId,
    reviewTraceId,
  };
}

export function useWorkflowRunner(
  project: ProjectManager,
  projectPath: string,
  projectId: string,
  chainsRef: React.MutableRefObject<Map<string, ActionChain>>,
  onChainsUpdated: () => void
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

  const doProcess = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;

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

        const chain = chainsRef.current.get(action.chainId);
        if (chain) {
          const step = chain.steps.find(s => s.actionId === action.actionId);
          if (step) {
            step.status = 'failed';
            step.reasoning = 'dependency failed';
          }
          chainsRef.current.set(action.chainId, chain);
          onChainsUpdated();
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
          // Find/create the chain
          const chain = chainsRef.current.get(action.chainId) ?? {
            chainId: action.chainId,
            summary: action.summary,
            steps: [],
            createdAt: action.createdAt,
          };

          // Mark workflow step as running
          const existingStep = chain.steps.find(
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
            chain.steps.push(runningStep);
          }
          chainsRef.current.set(action.chainId, chain);
          onChainsUpdated();

          const result = await processWorkflowAction(
            action,
            project,
            projectPath,
            projectId,
            store
          );

          // Mark workflow step as completed
          const step = chain.steps.find(s => s.actionId === action.actionId);
          if (step) {
            step.status = 'completed';
            step.reasoning = `task #${result.roverTaskId} on ${result.branchName}`;
          }

          // Add review step as pending
          chain.steps.push({
            actionId: result.reviewActionId,
            action: 'review',
            status: 'pending',
            timestamp: new Date().toISOString(),
            reasoning: action.meta?.title,
          });

          chainsRef.current.set(action.chainId, chain);
          onChainsUpdated();
          setProcessedCount(c => c + 1);
        } catch {
          // Mark step as failed in the chain
          const chain = chainsRef.current.get(action.chainId);
          if (chain) {
            const step = chain.steps.find(s => s.actionId === action.actionId);
            if (step) {
              step.status = 'failed';
            }
            chainsRef.current.set(action.chainId, chain);
            onChainsUpdated();
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
  }, [project, projectPath, projectId, chainsRef, onChainsUpdated]);

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
