import { ACPProvider, parseJsonResponse } from '@endorhq/agent';
import type { TaskDescriptionManager } from 'rover-core';
import { Git, ProjectConfigManager } from 'rover-core';
import { commitPromptTemplate } from 'rover-prompts';
import { SpanWriter, ActionWriter } from '../logging.js';
import { replacePromptPlaceholders } from '../prompts.js';
import type { PendingAction } from '../types.js';
import type { Step, StepConfig, StepContext, StepResult } from './types.js';

interface CommitterAIResult {
  status: 'committed' | 'no_changes' | 'failed';
  commit_sha: string | null;
  commit_message: string | null;
  error: string | null;
  recovery_actions_taken: string[];
  summary: string;
}

function getTaskIterationSummaries(task: TaskDescriptionManager): string[] {
  const { summaries } = task.getPreviousIterationArtifacts(Infinity);
  return summaries.map(s => s.content);
}

function buildCommitterUserMessage(
  title: string,
  description: string,
  summaries: string[],
  recentCommits: string[],
  branchName: string,
  attribution: boolean
): string {
  let msg = '## Task\n\n';
  msg += `**Title**: ${title}\n`;
  msg += `**Description**: ${description}\n`;
  msg += `**Branch**: ${branchName}\n\n`;

  if (attribution) {
    msg += '**Attribution**: Enabled — append the Co-Authored-By trailer.\n\n';
  } else {
    msg +=
      '**Attribution**: Disabled — do NOT append the Co-Authored-By trailer.\n\n';
  }

  if (summaries.length > 0) {
    msg += '## Iteration Summaries\n\n';
    for (let i = 0; i < summaries.length; i++) {
      msg += `### Iteration ${i + 1}\n\n${summaries[i]}\n\n`;
    }
  }

  if (recentCommits.length > 0) {
    msg += '## Recent Commits (for style reference)\n\n';
    for (let i = 0; i < recentCommits.length; i++) {
      msg += `${i + 1}. ${recentCommits[i]}\n`;
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

  async process(pending: PendingAction, ctx: StepContext): Promise<StepResult> {
    const { store, project } = ctx;
    const projectId = project.id;
    const projectPath = project.path;

    const actionData = store.readAction(pending.actionId);
    const meta = actionData?.meta ?? {};

    const span = new SpanWriter(projectId, {
      step: 'commit',
      parentId: actionData?.spanId ?? null,
      originAction: pending.actionId,
    });

    try {
      const taskId = meta.taskId as number;
      const branchName = (meta.branchName as string) || '';
      const title = (meta.title as string) || 'Untitled task';
      const description = (meta.description as string) || title;

      const task = project.getTask(taskId);
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      // FAILED task — skip commit
      if (task.status === 'FAILED') {
        span.fail(`commit: task #${taskId} failed, skipping`);

        const resolve = new ActionWriter(projectId, {
          action: 'resolve',
          spanId: span.id,
          reasoning: `Task ${taskId} failed — skipping commit`,
          meta: {
            ...meta,
            committed: false,
            taskStatus: 'FAILED',
          },
        });

        return {
          spanId: span.id,
          terminal: false,
          newActions: [{ actionId: resolve.id, action: 'resolve' }],
        };
      }

      // NO CHANGES — skip commit
      const git = new Git({ cwd: projectPath });
      if (!git.hasUncommittedChanges({ worktreePath: task.worktreePath })) {
        span.complete(`commit: task #${taskId}: skipped (no changes)`);

        const resolve = new ActionWriter(projectId, {
          action: 'resolve',
          spanId: span.id,
          reasoning: `Task ${taskId} has no uncommitted changes`,
          meta: {
            ...meta,
            committed: false,
            taskStatus: 'COMPLETED',
          },
        });

        return {
          spanId: span.id,
          terminal: false,
          newActions: [{ actionId: resolve.id, action: 'resolve' }],
        };
      }

      // AI INVOCATION — generate commit
      const summaries = getTaskIterationSummaries(task);
      const recentCommits = git.getRecentCommits({ branch: branchName });

      const config = ProjectConfigManager.load(projectPath);
      const attribution = config.attribution;

      const userMessage = buildCommitterUserMessage(
        title,
        description,
        summaries,
        recentCommits,
        branchName,
        attribution
      );

      const systemPrompt = replacePromptPlaceholders(commitPromptTemplate, {
        customInstructions: ctx.customInstructions,
      });

      const provider = ACPProvider.fromProject(projectPath);
      const response = await provider.invoke(userMessage, {
        json: true,
        systemPrompt,
        cwd: task.worktreePath,
      });

      const result = parseJsonResponse<CommitterAIResult>(response.response);

      if (!result) {
        span.fail('Failed to parse committer result from AI response');
        ctx.failTrace('Failed to parse committer result from AI response');
        return { spanId: span.id, terminal: true };
      }

      if (result.status === 'failed') {
        span.error(
          `commit: task #${taskId} failed — ${result.error ?? 'unknown'}`,
          { aiResult: result }
        );
      } else {
        span.complete(`commit: task #${taskId} — ${result.summary}`, {
          aiResult: result,
        });
      }

      const resolve = new ActionWriter(projectId, {
        action: 'resolve',
        spanId: span.id,
        reasoning: result.summary,
        meta: {
          ...meta,
          committed: result.status === 'committed',
          commitSha: result.commit_sha,
          commitMessage: result.commit_message,
          ...(result.error ? { commitError: result.error } : {}),
        },
      });

      return {
        spanId: span.id,
        terminal: false,
        newActions: [{ actionId: resolve.id, action: 'resolve' }],
        usage: response.usage,
      };
    } catch (error) {
      span.error(
        `Committer failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  },
};
