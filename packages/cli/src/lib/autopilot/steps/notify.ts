import { launch } from 'rover-core';
import { getUserAIAgent, getAIAgentTool } from '../../agents/index.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { SpanWriter } from '../logging.js';
import type {
  Span,
  ActionTrace,
  PendingAction,
  NotifyAIResult,
} from '../types.js';
import type {
  Step,
  StepConfig,
  StepDependencies,
  StepContext,
  StepResult,
} from './types.js';
import notifyPromptTemplate from './prompts/notify-prompt.md';

// ── Channel resolution ─────────────────────────────────────────────────────

export interface NotifyChannel {
  command: 'issue' | 'pr';
  number: number;
}

/**
 * Walk the span trace to find the root event span and determine the
 * GitHub delivery target (issue comment, PR comment, or nothing).
 */
export function resolveChannel(
  spans: Span[],
  _owner: string,
  _repo: string
): NotifyChannel | null {
  // The root span is the one with parent === null
  const rootSpan = spans.find(s => s.parent === null);
  if (!rootSpan) return null;

  const eventType = rootSpan.meta?.type as string | undefined;
  if (!eventType) return null;

  switch (eventType) {
    case 'IssuesEvent': {
      const num = rootSpan.meta?.issueNumber as number | undefined;
      return num ? { command: 'issue', number: num } : null;
    }

    case 'PullRequestEvent': {
      const num = rootSpan.meta?.prNumber as number | undefined;
      return num ? { command: 'pr', number: num } : null;
    }

    case 'IssueCommentEvent': {
      const isPR = rootSpan.meta?.isPullRequest as boolean | undefined;
      const num = (rootSpan.meta?.issueNumber ?? rootSpan.meta?.prNumber) as
        | number
        | undefined;
      if (!num) return null;
      return { command: isPR ? 'pr' : 'issue', number: num };
    }

    case 'PullRequestReviewEvent':
    case 'PullRequestReviewCommentEvent': {
      const num = rootSpan.meta?.prNumber as number | undefined;
      return num ? { command: 'pr', number: num } : null;
    }

    case 'PushEvent':
      return null;

    default:
      return null;
  }
}

// ── AI message composition ─────────────────────────────────────────────────

function buildNotifyUserMessage(
  spans: Span[],
  trace: ActionTrace,
  pendingMeta: Record<string, any>
): string {
  const input = {
    spans: spans.map(s => ({
      step: s.step,
      status: s.status,
      summary: s.summary,
      meta: s.meta,
    })),
    steps: trace.steps.map(s => ({
      action: s.action,
      status: s.status,
      reasoning: s.reasoning ?? null,
    })),
    context: pendingMeta,
  };

  return '```json\n' + JSON.stringify(input, null, 2) + '\n```';
}

// ── Fallback message ───────────────────────────────────────────────────────

export function buildFallbackMessage(
  spans: Span[],
  trace: ActionTrace
): string {
  const parts = spans.map(s => s.summary).filter(Boolean) as string[];

  if (parts.length === 0) {
    return `Autopilot finished processing: ${trace.summary}`;
  }

  return parts.join('\n\n');
}

// ── Comment posting ────────────────────────────────────────────────────────

async function postComment(
  channel: NotifyChannel,
  message: string,
  owner: string,
  repo: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await launch(
      'gh',
      [channel.command, 'comment', String(channel.number), '--body', message],
      { env: { GH_REPO: `${owner}/${repo}` } }
    );

    if (result.failed) {
      return {
        success: false,
        error: result.stderr?.toString() ?? 'gh comment failed',
      };
    }

    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err.message ?? 'unknown error posting comment',
    };
  }
}

// ── Step implementation ────────────────────────────────────────────────────

const GITHUB_COMMENT_LIMIT = 65536;
const TRUNCATION_LIMIT = 60000;

export const notifyStep: Step = {
  config: {
    actionType: 'notify',
    maxParallel: 5,
  } satisfies StepConfig,

  dependencies: {
    needsOwnerRepo: true,
  } satisfies StepDependencies,

  async process(pending: PendingAction, ctx: StepContext): Promise<StepResult> {
    const { store, projectId, projectPath, owner, repo, trace } = ctx;
    const meta = pending.meta ?? {};

    // 1. Get the full span chain
    const spans = store.getSpanTrace(pending.spanId);

    // 2. Resolve the GitHub delivery channel
    const channel = owner && repo ? resolveChannel(spans, owner, repo) : null;

    // 3. Compose the message via AI (haiku), with fallback
    let message: string;
    try {
      const userMessage = buildNotifyUserMessage(spans, trace, meta);
      const agent = getUserAIAgent();
      const agentTool = getAIAgentTool(agent);
      const response = await agentTool.invoke(userMessage, {
        json: true,
        model: 'haiku',
        systemPrompt: notifyPromptTemplate,
      });
      const result = parseJsonResponse<NotifyAIResult>(response);
      message = result.message;
    } catch {
      message = buildFallbackMessage(spans, trace);
    }

    // 4. Truncate if necessary
    if (message.length > TRUNCATION_LIMIT) {
      message =
        message.slice(0, TRUNCATION_LIMIT) +
        '\n\n---\n*Message truncated due to length.*';
    }

    // 5. Post the comment if we have a channel
    let posted = false;
    let postError: string | undefined;

    if (channel && owner && repo) {
      const result = await postComment(channel, message, owner, repo);
      posted = result.success;
      postError = result.error;
    }

    // 6. Create and finalize the span
    const spanMeta: Record<string, any> = {
      channel: channel
        ? { command: channel.command, number: channel.number }
        : null,
      posted,
      messageLength: message.length,
      ...(postError ? { postError } : {}),
      ...(meta.originalAction ? { originalAction: meta.originalAction } : {}),
    };

    const span = new SpanWriter(projectId, {
      step: 'notify',
      parentId: pending.spanId,
      meta: spanMeta,
    });

    if (!channel) {
      span.complete(`notify: no comment target (trace ends silently)`);
    } else if (posted) {
      span.complete(
        `notify: commented on ${channel.command} #${channel.number}`
      );
    } else {
      span.fail(
        `notify: failed to post on ${channel.command} #${channel.number}: ${postError ?? 'unknown'}`
      );
    }

    // 7. Clean up and return terminal
    store.removePending(pending.actionId);

    return {
      spanId: span.id,
      terminal: true,
      enqueuedActions: [],
      reasoning: channel
        ? posted
          ? `commented on ${channel.command} #${channel.number}`
          : `failed to comment on ${channel.command} #${channel.number}`
        : 'no comment target',
      status: !channel || posted ? 'completed' : 'failed',
    };
  },
};
