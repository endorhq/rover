import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { ProjectConfigManager, Git } from 'rover-core';
import { getUserAIAgent, getAIAgentTool } from '../../agents/index.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { SpanWriter, ActionWriter, enqueueAction } from '../logging.js';
import type { PendingAction, CommitterAIResult } from '../types.js';
import type {
  Step,
  StepConfig,
  StepDependencies,
  StepContext,
  StepResult,
} from './types.js';
import commitPromptTemplate from './prompts/commit-prompt.md';

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

function buildCommitterUserMessage(
  taskTitle: string,
  taskDescription: string,
  summaries: string[],
  recentCommits: string[],
  branchName: string,
  attribution: boolean
): string {
  let msg = '## Task\n\n';
  msg += `**Title**: ${taskTitle}\n\n`;
  msg += `**Description**: ${taskDescription}\n\n`;
  msg += `**Branch**: ${branchName}\n\n`;

  if (attribution) {
    msg += `**Attribution**: Append the following trailer to the commit message (after a blank line):\n`;
    msg += '`Co-Authored-By: Rover <noreply@endor.dev>`\n\n';
  }

  if (summaries.length > 0) {
    msg += '## Iteration Summaries\n\n';
    for (const summary of summaries) {
      msg += `- ${summary}\n`;
    }
    msg += '\n';
  }

  if (recentCommits.length > 0) {
    msg += '## Recent Commits (for style reference)\n\n';
    for (const commit of recentCommits) {
      msg += `- ${commit}\n`;
    }
    msg += '\n';
  }

  return msg;
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
        status: 'failed',
      };
    }

    // Task completed — invoke the committer agent
    const git = new Git({ cwd: projectPath });
    const summaries = getTaskIterationSummaries(task.iterationsPath());
    const recentCommits = git.getRecentCommits();

    const projectConfig = ProjectConfigManager.load(projectPath);
    const attribution =
      projectConfig == null || projectConfig?.attribution === true;

    const userMessage = buildCommitterUserMessage(
      task.title,
      task.description,
      summaries,
      recentCommits,
      branchName,
      attribution
    );

    const agent = getUserAIAgent();
    const agentTool = getAIAgentTool(agent);
    const response = await agentTool.invoke(userMessage, {
      json: true,
      cwd: task.worktreePath,
      systemPrompt: commitPromptTemplate,
      tools: ['Bash'],
    });

    const result = parseJsonResponse<CommitterAIResult>(response);

    // Build commit span based on result
    const committed = result.status === 'committed';
    const commitSha = result.commit_sha ?? null;

    const commitSpanMeta: Record<string, any> = {
      roverTaskId: taskId,
      branchName,
      committed,
      commitSha,
      taskStatus: 'COMPLETED',
      commitMessage: result.commit_message,
      recoveryActions: result.recovery_actions_taken,
      agentSummary: result.summary,
      ...(result.error ? { error: result.error } : {}),
    };

    const commitSpan = new SpanWriter(projectId, {
      step: 'commit',
      parentId: pending.spanId,
      meta: commitSpanMeta,
    });

    if (result.status === 'failed') {
      commitSpan.error(
        `commit: task #${taskId}: commit failed: ${result.error ?? 'unknown error'}`
      );
    } else {
      const statusLabel =
        result.status === 'committed' ? 'committed' : 'no changes';
      commitSpan.complete(`commit: task #${taskId}: ${statusLabel}`);
    }

    // Always enqueue a resolve action
    const resolveMeta = {
      ...meta,
      committed,
      taskStatus: 'COMPLETED',
      ...(result.error ? { commitError: result.error } : {}),
    };

    const resolveReasoning =
      result.status === 'failed'
        ? `Resolve task #${taskId}: ${meta.title} (commit failed: ${result.error})`
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

    const reasoning =
      result.status === 'failed'
        ? `task #${taskId} commit failed: ${result.error}`
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
      status: result.status === 'failed' ? 'error' : 'completed',
    };
  },
};
