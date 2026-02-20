import { Git, launch } from 'rover-core';
import { getUserAIAgent, getAIAgentTool } from '../../agents/index.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { SpanWriter, ActionWriter, enqueueAction } from '../logging.js';
import type { PendingAction, PusherAIResult, TaskMapping } from '../types.js';
import type {
  Step,
  StepConfig,
  StepDependencies,
  StepContext,
  StepResult,
} from './types.js';
import pushPromptTemplate from './prompts/push-prompt.md';

interface BranchInfo {
  taskId: number;
  branchName: string;
  worktreePath?: string;
}

async function checkExistingPR(
  owner: string,
  repo: string,
  branchName: string
): Promise<{ number: number; url: string; state: string } | null> {
  try {
    const result = await launch(
      'gh',
      [
        'pr',
        'list',
        '--head',
        branchName,
        '--json',
        'number,url,state',
        '--limit',
        '1',
      ],
      { env: { GH_REPO: `${owner}/${repo}` } }
    );
    if (result.failed || !result.stdout) return null;
    const prs = JSON.parse(result.stdout.toString());
    if (Array.isArray(prs) && prs.length > 0) {
      return prs[0];
    }
    return null;
  } catch {
    return null;
  }
}

function collectBranchInfos(
  trace: PendingAction['meta'] extends infer M ? M : never,
  traceSteps: { action: string; actionId: string }[],
  store: StepContext['store']
): BranchInfo[] {
  const seen = new Set<string>();
  const infos: BranchInfo[] = [];

  for (const step of traceSteps) {
    if (step.action !== 'workflow' && step.action !== 'commit') continue;
    const mapping = store.getTaskMapping(step.actionId);
    if (!mapping) continue;
    if (seen.has(mapping.branchName)) continue;
    seen.add(mapping.branchName);
    infos.push({
      taskId: mapping.taskId,
      branchName: mapping.branchName,
      worktreePath: undefined, // worktree path is in the task object
    });
  }

  return infos;
}

function buildPusherUserMessage(opts: {
  branches: BranchInfo[];
  owner?: string;
  repo?: string;
  mainBranch: string;
  traceSummary: string;
  existingPR: { number: number; url: string; state: string } | null;
  eventMeta: Record<string, any>;
}): string {
  let msg = '## Push Context\n\n';

  msg += `**Repository**: ${opts.owner}/${opts.repo}\n`;
  msg += `**Main branch**: ${opts.mainBranch}\n\n`;

  msg += '## Branches to Push\n\n';
  for (const branch of opts.branches) {
    msg += `- **${branch.branchName}** (task #${branch.taskId})\n`;
  }
  msg += '\n';

  msg += `## Trace Summary\n\n${opts.traceSummary}\n\n`;

  if (opts.existingPR) {
    msg += `## Existing Pull Request\n\n`;
    msg += `A PR already exists for the primary branch:\n`;
    msg += `- **URL**: ${opts.existingPR.url}\n`;
    msg += `- **Number**: #${opts.existingPR.number}\n`;
    msg += `- **State**: ${opts.existingPR.state}\n\n`;
  } else {
    msg += `## Pull Request\n\nNo existing PR found. Please create one after pushing.\n\n`;
  }

  if (Object.keys(opts.eventMeta).length > 0) {
    msg += '## Event Source\n\n';
    if (opts.eventMeta.type) {
      msg += `- **Event type**: ${opts.eventMeta.type}\n`;
    }
    if (opts.eventMeta.issueNumber) {
      msg += `- **Issue**: #${opts.eventMeta.issueNumber}\n`;
    }
    if (opts.eventMeta.prNumber) {
      msg += `- **PR**: #${opts.eventMeta.prNumber}\n`;
    }
    msg += '\n';
  }

  return msg;
}

export const pusherStep: Step = {
  config: {
    actionType: 'push',
    maxParallel: 2,
    dedupBy: 'traceId',
  } satisfies StepConfig,

  dependencies: {
    needsProjectManager: true,
    needsOwnerRepo: true,
  } satisfies StepDependencies,

  async process(pending: PendingAction, ctx: StepContext): Promise<StepResult> {
    const { store, projectId, projectPath, project, owner, repo, trace } = ctx;

    if (!project) {
      throw new Error('Pusher step requires a ProjectManager');
    }

    const meta = pending.meta ?? {};

    // Collect branch info from all workflow/commit steps in this trace
    const branches = collectBranchInfos(meta, trace.steps, store);

    if (branches.length === 0) {
      // Fallback: try to get branch info from the pending action's own meta
      const sourceActionId = meta.sourceActionId;
      if (sourceActionId) {
        const mapping = store.getTaskMapping(sourceActionId);
        if (mapping) {
          branches.push({
            taskId: mapping.taskId,
            branchName: mapping.branchName,
          });
        }
      }
    }

    if (branches.length === 0) {
      const pushSpan = new SpanWriter(projectId, {
        step: 'push',
        parentId: pending.spanId,
        meta: { error: 'no branches found' },
      });
      pushSpan.fail('push: no branches found to push');

      store.removePending(pending.actionId);

      return {
        spanId: pushSpan.id,
        terminal: true,
        enqueuedActions: [],
        reasoning: 'no branches found to push',
        status: 'failed',
      };
    }

    // Determine main branch
    const git = new Git({ cwd: projectPath });
    const mainBranch = git.getMainBranch();

    // Check for existing PR on the primary branch
    const primaryBranch = branches[0].branchName;
    const existingPR =
      owner && repo ? await checkExistingPR(owner, repo, primaryBranch) : null;

    // Extract root event metadata from span trace
    const spans = store.getSpanTrace(pending.spanId);
    const rootSpan = spans.length > 0 ? spans[0] : null;
    const eventMeta: Record<string, any> = {};
    if (rootSpan?.meta) {
      if (rootSpan.meta.type) eventMeta.type = rootSpan.meta.type;
      if (rootSpan.meta.issueNumber)
        eventMeta.issueNumber = rootSpan.meta.issueNumber;
      if (rootSpan.meta.prNumber) eventMeta.prNumber = rootSpan.meta.prNumber;
    }

    // Build the user message for the AI agent
    const userMessage = buildPusherUserMessage({
      branches,
      owner,
      repo,
      mainBranch,
      traceSummary: trace.summary,
      existingPR,
      eventMeta,
    });

    // Determine a working directory — use the first task's worktree if available
    const firstTask = project.getTask(branches[0].taskId);
    const cwd = firstTask?.worktreePath ?? projectPath;

    // Invoke the AI agent
    const agent = getUserAIAgent();
    const agentTool = getAIAgentTool(agent);
    const response = await agentTool.invoke(userMessage, {
      json: true,
      cwd,
      systemPrompt: pushPromptTemplate,
      tools: ['Bash'],
    });

    const result = parseJsonResponse<PusherAIResult>(response);

    // Build push span
    const pushed = result.status === 'pushed';
    const pushSpanMeta: Record<string, any> = {
      pushed,
      branchesPushed: result.branches_pushed,
      pullRequest: result.pull_request,
      agentSummary: result.summary,
      ...(result.error ? { error: result.error } : {}),
    };

    const pushSpan = new SpanWriter(projectId, {
      step: 'push',
      parentId: pending.spanId,
      meta: pushSpanMeta,
    });

    if (result.status === 'failed') {
      pushSpan.error(`push: failed: ${result.error ?? 'unknown error'}`);
    } else {
      const prInfo = result.pull_request?.url
        ? ` (PR: ${result.pull_request.url})`
        : '';
      pushSpan.complete(`push: ${result.branches_pushed.join(', ')}${prInfo}`);
    }

    // Enqueue a notify/noop action to complete the trace
    const notifyMeta = {
      ...meta,
      pushed,
      branchesPushed: result.branches_pushed,
      pullRequestUrl: result.pull_request?.url ?? null,
    };

    const notifyAction = new ActionWriter(projectId, {
      action: 'notify',
      spanId: pushSpan.id,
      reasoning: pushed
        ? `Push completed: ${result.summary}`
        : `Push failed: ${result.error ?? 'unknown'}`,
      meta: notifyMeta,
    });

    enqueueAction(store, {
      traceId: pending.traceId,
      action: notifyAction,
      step: 'push',
      summary: pushed
        ? `done: ${trace.summary}`
        : `push failed: ${trace.summary}`,
    });

    store.removePending(pending.actionId);

    const prUrl = result.pull_request?.url;
    const reasoning =
      result.status === 'failed'
        ? `push failed: ${result.error}`
        : prUrl
          ? `pushed ${result.branches_pushed.join(', ')} — PR: ${prUrl}`
          : `pushed ${result.branches_pushed.join(', ')}`;

    return {
      spanId: pushSpan.id,
      terminal: false,
      enqueuedActions: [
        {
          actionId: notifyAction.id,
          actionType: 'notify',
          summary: trace.summary,
        },
      ],
      reasoning,
      status: result.status === 'failed' ? 'error' : 'completed',
    };
  },
};
