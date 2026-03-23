import { Git, type TaskDescriptionManager } from 'rover-core';
import { SpanWriter, ActionWriter } from '../logging.js';
import type { PendingAction, TaskMapping } from '../types.js';
import type { Step, StepConfig, StepContext, StepResult } from './types.js';
import { getUserAIAgent } from '../../agents/index.js';
import { generateBranchName } from '../../../utils/branch-name.js';
import { TaskSetup } from '../../task-setup.js';

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

      branchName = generateBranchName(task.id);

      const setup = TaskSetup.initial(
        project,
        task,
        git,
        branchName,
        baseBranch
      );
      setup.createIteration(title, description);

      const contextUris = (meta.context_uris as string[]) ?? [];
      await setup.fetchContext(contextUris, { bestEffort: true });

      await setup.start();

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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
