import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { ProjectConfigManager, Git } from 'rover-core';
import { getUserAIAgent, getAIAgentTool } from '../../agents/index.js';
import { SpanWriter, ActionWriter, enqueueAction } from '../logging.js';
import type { PendingAction } from '../types.js';
import type {
  Step,
  StepConfig,
  StepDependencies,
  StepContext,
  StepResult,
} from './types.js';

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

export const committerStep: Step = {
  config: {
    actionType: 'commit',
    maxParallel: 3,
  } satisfies StepConfig,

  dependencies: {
    needsProjectManager: true,
  } satisfies StepDependencies,

  async process(pending: PendingAction, ctx: StepContext): Promise<StepResult> {
    const { store, projectId, projectPath, project } = ctx;

    if (!project) {
      throw new Error('Committer step requires a ProjectManager');
    }

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
      const commitSpan = new SpanWriter(projectId, {
        step: 'commit',
        parentId: pending.spanId,
        meta: {
          roverTaskId: taskId,
          branchName,
          committed: false,
          commitSha: null,
          taskStatus: 'FAILED',
          error: task.error ?? 'unknown error',
        },
      });
      commitSpan.fail(`commit: task #${taskId} failed, skipping commit`);

      const resolveMeta = {
        ...meta,
        committed: false,
        taskStatus: 'FAILED',
      };

      const resolveAction = new ActionWriter(projectId, {
        action: 'resolve',
        spanId: commitSpan.id,
        reasoning: `Resolve task #${taskId}: ${meta.title} (failed)`,
        meta: resolveMeta,
      });

      enqueueAction(store, {
        traceId: pending.traceId,
        action: resolveAction,
        step: 'commit',
        summary: `resolve: ${meta.title}`,
      });

      store.removePending(pending.actionId);

      return {
        spanId: commitSpan.id,
        terminal: false,
        enqueuedActions: [
          {
            actionId: resolveAction.id,
            actionType: 'resolve',
            summary: meta.title,
          },
        ],
        reasoning: `task #${taskId} failed, skipping commit`,
      };
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
    const commitSpanMeta: Record<string, any> = {
      roverTaskId: taskId,
      branchName,
      committed,
      commitSha,
      taskStatus: 'COMPLETED',
      ...(commitError ? { commitError } : {}),
    };

    const commitSpan = new SpanWriter(projectId, {
      step: 'commit',
      parentId: pending.spanId,
      meta: commitSpanMeta,
    });

    const commitSummary = commitError
      ? `commit: task #${taskId}: commit failed`
      : `commit: task #${taskId}: ${committed ? 'committed' : 'no changes'}`;

    if (commitError) {
      commitSpan.error(commitSummary);
    } else {
      commitSpan.complete(commitSummary);
    }

    // Write resolve action and enqueue
    const resolveMeta = {
      ...meta,
      committed,
      taskStatus: 'COMPLETED',
      ...(commitError ? { commitError } : {}),
    };

    const resolveReasoning = commitError
      ? `Resolve task #${taskId}: ${meta.title} (commit failed: ${commitError.message})`
      : `Resolve task #${taskId}: ${meta.title} (${committed ? 'committed' : 'no changes'})`;

    const resolveAction = new ActionWriter(projectId, {
      action: 'resolve',
      spanId: commitSpan.id,
      reasoning: resolveReasoning,
      meta: resolveMeta,
    });

    enqueueAction(store, {
      traceId: pending.traceId,
      action: resolveAction,
      step: 'commit',
      summary: `resolve: ${meta.title}`,
    });

    store.removePending(pending.actionId);

    const reasoning = commitError
      ? `task #${taskId} commit failed: ${commitError.message}`
      : committed
        ? `task #${taskId} committed on ${branchName}`
        : `task #${taskId} no changes`;

    return {
      spanId: commitSpan.id,
      terminal: false,
      enqueuedActions: [
        {
          actionId: resolveAction.id,
          actionType: 'resolve',
          summary: meta.title,
        },
      ],
      reasoning,
    };
  },
};
