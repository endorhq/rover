import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  ProjectConfigManager,
  IterationManager,
  Git,
  ContextManager,
  generateContextIndex,
  registerBuiltInProviders,
  type TaskDescriptionManager,
} from 'rover-core';
import { SpanWriter, ActionWriter } from '../logging.js';
import type { AutopilotStore } from '../store.js';
import type { PendingAction, TaskMapping } from '../types.js';
import type { Step, StepConfig, StepContext, StepResult } from './types.js';
import { createSandbox } from '../../sandbox/index.js';
import { resolveAgentImage } from '../../sandbox/container-common.js';
import { getUserAIAgent } from '../../agents/index.js';
import { generateBranchName } from '../../../utils/branch-name.js';
import { copyEnvironmentFiles } from '../../../utils/env-files.js';

const POLL_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 2 * 60 * 60 * 1_000; // 2 hours

/**
 * Create a commit action that tells downstream steps a task finished
 * successfully and produced commits on a branch.
 */
function createCommitAction(
  projectId: string,
  spanId: string,
  taskId: number,
  branchName: string,
  meta: Record<string, unknown>
): { actionId: string; action: string } {
  const action = new ActionWriter(projectId, {
    action: 'commit',
    spanId,
    reasoning: `Task ${taskId} completed on branch ${branchName}`,
    meta: {
      ...meta,
      taskId,
      branchName,
    },
  });
  return { actionId: action.id, action: 'commit' };
}

export const workflowStep: Step = {
  config: {
    actionType: 'workflow',
    maxParallel: 3,
  } satisfies StepConfig,

  async process(pending: PendingAction, ctx: StepContext): Promise<StepResult> {
    const { store, project } = ctx;
    const projectId = project.id;
    const projectPath = project.path;

    // Check running task limit
    const allMappings = store.getAllTaskMappings();
    const runningCount = Object.values(allMappings).filter(
      m => m.workflowSpanId && !isTerminalMapping(m, store)
    ).length;
    if (runningCount >= 3) {
      return { spanId: '', status: 'pending' };
    }

    // Read action data from disk
    const actionData = store.readAction(pending.actionId);
    const meta = actionData?.meta ?? {};

    const span = new SpanWriter(projectId, {
      step: 'workflow',
      parentId: actionData?.spanId ?? null,
      originAction: pending.actionId,
      meta,
    });

    // Dependency resolution
    const dependsOnActionId = meta.depends_on_action_id as string | undefined;
    if (dependsOnActionId) {
      const depMapping = store.getTaskMapping(dependsOnActionId);
      if (!depMapping) {
        // Dependency not yet processed
        return { spanId: '', status: 'pending' };
      }
      // Check if dependency's span failed
      const depSpan = depMapping.workflowSpanId
        ? store.readSpan(depMapping.workflowSpanId)
        : null;
      if (
        depSpan &&
        (depSpan.status === 'failed' || depSpan.status === 'error')
      ) {
        const reason = `Dependency action ${dependsOnActionId} failed`;
        span.error(reason);
        ctx.failTrace(reason);
        return { spanId: span.id, terminal: true };
      }
    }

    let task: TaskDescriptionManager | undefined;
    let branchName: string;

    try {
      const title = (meta.title as string) || 'Autopilot task';
      const description =
        (meta.description as string) || (meta.context as string) || title;

      // Resolve base branch: dependency branch or default
      const git = new Git({ cwd: projectPath });
      let baseBranch: string;
      if (dependsOnActionId) {
        const depMapping = store.getTaskMapping(dependsOnActionId);
        baseBranch = depMapping?.branchName ?? git.getMainBranch();
      } else {
        baseBranch = (meta.base_branch as string) || git.getMainBranch();
      }

      // Create task
      const selectedAgent = getUserAIAgent();
      task = project.createTask({
        title,
        description,
        inputs: new Map<string, string>(),
        workflowName: (meta.workflow_name as string) || 'default',
        agent: selectedAgent,
        sourceBranch: baseBranch,
        source: { type: 'github' },
      });

      // Create worktree
      const worktreePath = project.getWorkspacePath(task.id);
      branchName = generateBranchName(task.id);

      git.createWorktree(worktreePath, branchName, baseBranch);

      // Copy .env files
      copyEnvironmentFiles(projectPath, worktreePath);

      // Sparse checkout
      const projectConfig = ProjectConfigManager.load(projectPath);
      if (
        projectConfig.excludePatterns &&
        projectConfig.excludePatterns.length > 0
      ) {
        git.setupSparseCheckout(worktreePath, projectConfig.excludePatterns);
      }

      // Create initial iteration
      const iterationPath = join(
        task.iterationsPath(),
        task.iterations.toString()
      );
      mkdirSync(iterationPath, { recursive: true });

      const iteration = IterationManager.createInitial(
        iterationPath,
        task.id,
        title,
        description
      );

      // Context injection (best-effort)
      try {
        const contextUris = (meta.context_uris as string[]) ?? [];
        if (contextUris.length > 0) {
          registerBuiltInProviders();
          const contextManager = new ContextManager(contextUris, task, {
            cwd: projectPath,
          });
          const entries = await contextManager.fetchAndStore();
          iteration.setContext(entries);

          const indexContent = generateContextIndex(entries, task.iterations);
          writeFileSync(
            join(contextManager.getContextDir(), 'index.md'),
            indexContent
          );
        }
      } catch {
        // Context injection is best-effort
      }

      // Finalize task metadata
      task.setWorkspace(worktreePath, branchName);
      task.markInProgress();

      const agentImage = resolveAgentImage(projectConfig);
      task.setAgentImage(agentImage);

      const sandbox = await createSandbox(task, undefined, {
        projectPath,
        iterationLogsPath: project.getTaskIterationLogsPath(
          task.id,
          task.iterations
        ),
      });
      const containerId = await sandbox.createAndStart();
      task.setContainerInfo(containerId, 'running');

      const mapping: TaskMapping = {
        taskId: task.id,
        branchName,
        traceId: pending.traceId,
        workflowSpanId: span.id,
      };
      store.setTaskMapping(pending.actionId, mapping);
    } catch (error) {
      span.error(
        `Workflow setup failed: ${error instanceof Error ? error.message : String(error)}`
      );
      if (task) {
        task.resetToNew();
      }
      throw error;
    }

    const pollInterval = (meta._pollIntervalMs as number) ?? POLL_INTERVAL_MS;
    const timeout = (meta._timeoutMs as number) ?? TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await sleep(pollInterval);

      task.updateStatusFromIteration();
      const status = task.status;

      if (status === 'COMPLETED') {
        span.complete(`workflow: task ${task.id} completed on ${branchName}`, {
          taskId: task.id,
          branchName,
        });

        const commitAction = createCommitAction(
          projectId,
          span.id,
          task.id,
          branchName,
          meta
        );

        return {
          spanId: span.id,
          terminal: false,
          newActions: [commitAction],
        };
      }

      if (status === 'FAILED') {
        const reason = `Task ${task.id} failed: ${task.error ?? 'unknown error'}`;
        span.fail(reason, { taskId: task.id });
        ctx.failTrace(reason);
        return { spanId: span.id, terminal: true };
      }
    }

    // Timeout
    const reason = `Task ${task.id} timed out after ${timeout / 1000}s`;
    span.error(reason, { taskId: task.id });
    ctx.failTrace(reason);
    return { spanId: span.id, terminal: true };
  },
};

/** Check whether a mapping's workflow span is in a terminal state. */
function isTerminalMapping(
  mapping: TaskMapping,
  store: AutopilotStore
): boolean {
  if (!mapping.workflowSpanId) return true;
  const spanData = store.readSpan(mapping.workflowSpanId);
  if (!spanData) return true;
  return (
    spanData.status === 'completed' ||
    spanData.status === 'failed' ||
    spanData.status === 'error'
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
