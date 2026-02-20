import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { ProjectConfigManager, IterationManager, Git } from 'rover-core';
import { getUserAIAgent } from '../../agents/index.js';
import { createSandbox } from '../../sandbox/index.js';
import { resolveAgentImage } from '../../sandbox/container-common.js';
import { generateBranchName } from '../../../utils/branch-name.js';
import { copyEnvironmentFiles } from '../../../utils/env-files.js';
import {
  SpanWriter,
  ActionWriter,
  enqueueAction,
  finalizeSpan,
} from '../logging.js';
import type { PendingAction, ActionTrace } from '../types.js';

const MAX_RUNNING_TASKS = 3;
import type {
  Step,
  StepConfig,
  StepDependencies,
  StepContext,
  StepResult,
  MonitorContext,
  TraceMutations,
} from './types.js';

function enqueueCommitAction(
  projectId: string,
  pending: PendingAction,
  roverTaskId: number,
  branchName: string,
  workflowSpanId: string,
  taskStatus: string,
  store: import('../store.js').AutopilotStore
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

export const workflowStep: Step = {
  config: {
    actionType: 'workflow',
    maxParallel: 3,
  } satisfies StepConfig,

  dependencies: {
    needsProjectManager: true,
  } satisfies StepDependencies,

  async process(pending: PendingAction, ctx: StepContext): Promise<StepResult> {
    const { store, projectId, projectPath, project } = ctx;

    if (!project) {
      throw new Error('Workflow step requires a ProjectManager');
    }

    const meta = pending.meta ?? {};

    // Check running task count — respect concurrent task limit
    const allTasks = project.listTasks();
    const runningCount = allTasks.filter(t =>
      ['IN_PROGRESS', 'ITERATING'].includes(t.status)
    ).length;
    if (runningCount >= MAX_RUNNING_TASKS) {
      // No slots available — leave action pending for next drain
      return {
        spanId: '',
        terminal: false,
        enqueuedActions: [],
        reasoning: '',
        status: 'pending',
      };
    }

    // Dependency resolution
    if (meta.depends_on_action_id) {
      const depMapping = store.getTaskMapping(meta.depends_on_action_id);
      if (!depMapping) {
        // Dependency hasn't been processed yet — wait
        return {
          spanId: '',
          terminal: false,
          enqueuedActions: [],
          reasoning: '',
          status: 'pending',
        };
      }

      const depTask = project.getTask(depMapping.taskId);
      if (!depTask) {
        return {
          spanId: '',
          terminal: false,
          enqueuedActions: [],
          reasoning: '',
          status: 'pending',
        };
      }

      if (depTask.status === 'FAILED') {
        // Dependency failed — mark this action as failed
        store.removePending(pending.actionId);
        return {
          spanId: '',
          terminal: true,
          enqueuedActions: [],
          reasoning: 'dependency failed',
          status: 'failed',
        };
      }

      if (depTask.status !== 'COMPLETED') {
        // Dependency not yet complete — wait
        return {
          spanId: '',
          terminal: false,
          enqueuedActions: [],
          reasoning: '',
          status: 'pending',
        };
      }
    }

    const git = new Git({ cwd: projectPath });

    // 1. Resolve source branch (dependency branching)
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
    const iterationPath = join(
      task.iterationsPath(),
      task.iterations.toString()
    );
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

    // 7. Store actionId -> task mapping (with trace context for monitor phase)
    store.setTaskMapping(pending.actionId, {
      taskId,
      branchName,
      traceId: pending.traceId,
      workflowSpanId: workflowSpan.id,
    });

    // 8. Remove processed workflow action from pending
    // NOTE: No manual appendLog here — the action was already logged when the
    // planner enqueued it. Re-logging with the new workflowSpan would violate
    // the invariant (different spanId, same actionId).
    store.removePending(pending.actionId);

    return {
      spanId: workflowSpan.id,
      terminal: false,
      enqueuedActions: [],
      reasoning: `task #${taskId} on ${branchName}`,
      status: 'running',
    };
  },

  monitor(ctx: MonitorContext): TraceMutations | null {
    const { store, projectId, project, traces } = ctx;

    if (!project) return null;

    const mappings = store.getAllTaskMappings();
    const updates: TraceMutations['updates'] = [];

    for (const [actionId, mapping] of Object.entries(mappings)) {
      if (!mapping.traceId || !mapping.workflowSpanId) continue;

      // Check trace step status — only process steps that are still 'running'
      const trace = traces.get(mapping.traceId);
      if (!trace) continue;

      const step = trace.steps.find(s => s.actionId === actionId);
      if (!step || step.status !== 'running') continue;

      const task = project.getTask(mapping.taskId);
      if (!task) continue;

      // Refresh status from iteration files on disk — the container writes
      // results there but nothing updates the task status automatically.
      // May throw if status.json doesn't exist yet (race with sandbox startup).
      try {
        task.updateStatusFromIteration();
      } catch {
        continue;
      }
      const taskStatus = task.status;

      if (taskStatus === 'COMPLETED') {
        finalizeSpan(
          projectId,
          mapping.workflowSpanId,
          'completed',
          `workflow: task #${mapping.taskId} completed on ${mapping.branchName}`
        );

        const pendingForCommit: PendingAction = {
          traceId: mapping.traceId,
          actionId,
          spanId: mapping.workflowSpanId,
          action: 'workflow',
          summary: step.reasoning ?? '',
          createdAt: step.timestamp,
          meta: {
            workflow: step.action,
            title: task.title,
            description: task.description,
          },
        };

        const { commitActionId } = enqueueCommitAction(
          projectId,
          pendingForCommit,
          mapping.taskId,
          mapping.branchName,
          mapping.workflowSpanId,
          'COMPLETED',
          store
        );

        updates.push({
          traceId: mapping.traceId,
          stepUpdates: [
            {
              actionId,
              status: 'completed',
              reasoning: `task #${mapping.taskId} on ${mapping.branchName}`,
            },
          ],
          newSteps: [
            {
              actionId: commitActionId,
              action: 'commit',
              status: 'pending',
              timestamp: new Date().toISOString(),
              reasoning: task.title,
            },
          ],
        });
      } else if (taskStatus === 'FAILED') {
        const errorMessage = task.error ?? 'unknown error';

        finalizeSpan(
          projectId,
          mapping.workflowSpanId,
          'failed',
          `workflow: task #${mapping.taskId} failed: ${errorMessage}`,
          { error: errorMessage }
        );

        const pendingForCommit: PendingAction = {
          traceId: mapping.traceId,
          actionId,
          spanId: mapping.workflowSpanId,
          action: 'workflow',
          summary: step.reasoning ?? '',
          createdAt: step.timestamp,
          meta: {
            workflow: step.action,
            title: task.title,
            description: task.description,
          },
        };

        const { commitActionId } = enqueueCommitAction(
          projectId,
          pendingForCommit,
          mapping.taskId,
          mapping.branchName,
          mapping.workflowSpanId,
          'FAILED',
          store
        );

        updates.push({
          traceId: mapping.traceId,
          stepUpdates: [
            {
              actionId,
              status: 'failed',
              reasoning: errorMessage,
            },
          ],
          newSteps: [
            {
              actionId: commitActionId,
              action: 'commit',
              status: 'pending',
              timestamp: new Date().toISOString(),
              reasoning: `${task.title} (failed: ${errorMessage})`,
            },
          ],
        });
      }
      // Otherwise (IN_PROGRESS, ITERATING, NEW) — skip, check next cycle
    }

    if (updates.length === 0) return null;

    return { updates };
  },
};
