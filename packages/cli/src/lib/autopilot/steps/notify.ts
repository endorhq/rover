import { launch } from 'rover-core';
import { getUserAIAgent, getAIAgentTool } from '../../agents/index.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { SpanWriter } from '../logging.js';
import { ROVER_FOOTER_MARKER } from '../constants.js';
import { recordTraceCompletion } from '../memory/writer.js';
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

// ── Rover footer ──────────────────────────────────────────────────────────

export function buildRoverFooter(traceId: string, actionId: string): string {
  return `\n\n<details>\n${ROVER_FOOTER_MARKER}\n\nTrace: \`${traceId}\` | Action: \`${actionId}\`\n\n</details>`;
}

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

// ── PR review posting ───────────────────────────────────────────────────────

interface ReviewData {
  body: string;
  decision: string;
  comments: Array<{ path: string; line: number; body: string }>;
}

/**
 * Map review decision to GitHub PR review event.
 */
function mapDecisionToEvent(decision: string): string {
  switch (decision) {
    case 'approve':
      return 'APPROVE';
    case 'request-changes':
      return 'REQUEST_CHANGES';
    case 'comment':
    default:
      return 'COMMENT';
  }
}

/**
 * Post a proper GitHub PR review with inline comments.
 */
async function postPRReview(
  prNumber: number,
  review: ReviewData,
  owner: string,
  repo: string
): Promise<{ success: boolean; error?: string }> {
  const event = mapDecisionToEvent(review.decision);

  const payload = JSON.stringify({
    body: review.body,
    event,
    comments: review.comments.map(c => ({
      path: c.path,
      line: c.line,
      body: c.body,
    })),
  });

  try {
    const result = await launch(
      'gh',
      [
        'api',
        `repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
        '--method',
        'POST',
        '--input',
        '-',
      ],
      {
        env: { GH_REPO: `${owner}/${repo}` },
        input: payload,
      }
    );

    if (result.failed) {
      return {
        success: false,
        error: result.stderr?.toString() ?? 'gh api review failed',
      };
    }

    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err.message ?? 'unknown error posting PR review',
    };
  }
}

// ── Step implementation ────────────────────────────────────────────────────

const GITHUB_COMMENT_LIMIT = 65536;
const TRUNCATION_LIMIT = 59850; // Leave room for the Rover footer (~150 chars)

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

    // 3. Ask AI whether notification is needed and compose message
    let shouldNotify = true;
    let message = '';
    let aiReasoning = '';

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
      shouldNotify = result.notify;
      message = result.message;
      aiReasoning = result.reasoning ?? '';
    } catch {
      // AI failed — fall back to posting so we don't silently drop failures
      message = buildFallbackMessage(spans, trace);
    }

    // 4. If AI decided notification is not needed, end the trace silently
    if (!shouldNotify) {
      const span = new SpanWriter(projectId, {
        step: 'notify',
        parentId: pending.spanId,
        meta: {
          skipped: true,
          aiReasoning,
          ...(meta.originalAction
            ? { originalAction: meta.originalAction }
            : {}),
        },
      });

      span.complete(`notify: skipped — ${aiReasoning || 'not needed'}`);

      // Record trace completion in memory
      await recordTraceCompletion(ctx.memoryStore, trace, spans, store, {
        decision: 'notify-skipped',
      });

      store.removePending(pending.actionId);

      return {
        spanId: span.id,
        terminal: true,
        enqueuedActions: [],
        reasoning: `skipped: ${aiReasoning || 'notification not needed'}`,
      };
    }

    // 5. Truncate if necessary
    if (message.length > TRUNCATION_LIMIT) {
      message =
        message.slice(0, TRUNCATION_LIMIT) +
        '\n\n---\n*Message truncated due to length.*';
    }

    // 5b. Append the Rover footer for self-comment detection
    const footer = buildRoverFooter(pending.traceId, pending.actionId);
    message += footer;

    // 6. Post the comment (or PR review) if we have a channel
    let posted = false;
    let postError: string | undefined;
    let usedReviewAPI = false;

    if (channel && owner && repo) {
      // If review data is present and we're targeting a PR, use the review API
      if (meta.review && channel.command === 'pr') {
        usedReviewAPI = true;
        const review = meta.review as ReviewData;
        // Append footer to review body for self-comment detection
        review.body = (review.body || '') + footer;
        const reviewResult = await postPRReview(
          channel.number,
          review,
          owner,
          repo
        );
        posted = reviewResult.success;
        postError = reviewResult.error;

        // Fall back to a regular comment if the review API fails
        if (!posted) {
          const fallbackMessage = review.body || message;
          const commentResult = await postComment(
            channel,
            fallbackMessage,
            owner,
            repo
          );
          posted = commentResult.success;
          postError = posted ? undefined : commentResult.error;
          usedReviewAPI = false;
        }
      } else {
        const result = await postComment(channel, message, owner, repo);
        posted = result.success;
        postError = result.error;
      }
    }

    // 7. Create and finalize the span
    const spanMeta: Record<string, any> = {
      channel: channel
        ? { command: channel.command, number: channel.number }
        : null,
      posted,
      messageLength: message.length,
      ...(usedReviewAPI ? { usedReviewAPI: true } : {}),
      ...(aiReasoning ? { aiReasoning } : {}),
      ...(postError ? { postError } : {}),
      ...(meta.originalAction ? { originalAction: meta.originalAction } : {}),
      ...(meta.reviewWorkflow ? { reviewWorkflow: true } : {}),
    };

    const span = new SpanWriter(projectId, {
      step: 'notify',
      parentId: pending.spanId,
      meta: spanMeta,
    });

    if (!channel) {
      span.complete(`notify: no comment target (trace ends silently)`);
    } else if (posted) {
      const method = usedReviewAPI ? 'reviewed' : 'commented on';
      span.complete(`notify: ${method} ${channel.command} #${channel.number}`);
    } else {
      span.fail(
        `notify: failed to post on ${channel.command} #${channel.number}: ${postError ?? 'unknown'}`
      );
    }

    // 8. Record trace completion in memory
    const prUrl = (meta.pullRequestUrl as string) ?? null;
    await recordTraceCompletion(ctx.memoryStore, trace, spans, store, {
      decision: 'notify',
      prUrl: prUrl ?? undefined,
    });

    // 9. Clean up and return terminal
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
