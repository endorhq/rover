import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { Git, launch } from 'rover-core';
import { invokeAI, appendPromptSuffix } from './ai.js';
import { SpanWriter, emitAction } from '../logging.js';
import { ROVER_FOOTER_MARKER } from '../constants.js';
import type {
  PendingAction,
  PusherAIResult,
  TaskMapping,
  ActionTrace,
} from '../types.js';
import type {
  Step,
  StepConfig,
  StepDependencies,
  StepContext,
  StepResult,
} from './types.js';
import type { AutopilotStore } from '../store.js';
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
  traceSteps: { action: string; originAction: string | null }[],
  store: StepContext['store']
): BranchInfo[] {
  const seen = new Set<string>();
  const infos: BranchInfo[] = [];

  for (const step of traceSteps) {
    if (step.action !== 'workflow' && step.action !== 'commit') continue;
    if (!step.originAction) continue;
    const mapping = store.getTaskMapping(step.originAction);
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

/**
 * Gather workflow output files from task iteration directories.
 * Returns a map of output name → content for the AI to analyze.
 */
function gatherWorkflowOutputs(
  trace: ActionTrace,
  store: AutopilotStore,
  project: import('rover-core').ProjectManager | undefined,
  workflowProfile?: {
    outputs: Array<{ name: string; type: string; filename?: string }>;
  }
): Record<string, string> {
  if (!project) return {};
  const outputs: Record<string, string> = {};

  for (const step of trace.steps) {
    if (step.status !== 'completed' || !step.originAction) continue;
    const mapping = store.getTaskMapping(step.originAction);
    if (!mapping) continue;

    const task = project.getTask(mapping.taskId);
    if (!task || typeof task.iterationsPath !== 'function') continue;

    const iterationPath = join(
      task.iterationsPath(),
      task.iterations.toString()
    );
    const declaredOutputs = workflowProfile?.outputs ?? [];

    for (const output of declaredOutputs) {
      if (output.filename && output.type === 'file') {
        const filePath = join(iterationPath, output.filename);
        if (existsSync(filePath)) {
          try {
            outputs[output.name] = readFileSync(filePath, 'utf-8');
          } catch {
            /* skip unreadable */
          }
        }
      }
    }
  }
  return outputs;
}

function buildPusherUserMessage(opts: {
  branches: BranchInfo[];
  owner?: string;
  repo?: string;
  mainBranch: string;
  traceSummary: string;
  existingPR: { number: number; url: string; state: string } | null;
  eventMeta: Record<string, any>;
  traceId: string;
  actionId: string;
  workflowOutputs?: Record<string, string>;
  workflowProfile?: {
    description?: string;
    outputs?: Array<{ name: string; type: string; filename?: string }>;
    inputs?: Array<{ name: string; type: string; description?: string }>;
  };
  workflowName?: string;
}): string {
  let msg = '## Push Context\n\n';

  msg += `**Repository**: ${opts.owner}/${opts.repo}\n`;
  msg += `**Main branch**: ${opts.mainBranch}\n\n`;

  // Workflow profile for AI context
  if (opts.workflowProfile) {
    msg += '## Workflow\n\n';
    msg += `**Name**: ${opts.workflowName ?? 'unknown'}\n`;
    if (opts.workflowProfile.description) {
      msg += `**Description**: ${opts.workflowProfile.description}\n`;
    }
    if (
      opts.workflowProfile.outputs &&
      opts.workflowProfile.outputs.length > 0
    ) {
      msg += '**Declared outputs**:\n';
      for (const o of opts.workflowProfile.outputs) {
        const fn = o.filename ? ` → \`${o.filename}\`` : '';
        msg += `- \`${o.name}\` (${o.type}${fn})\n`;
      }
    }
    msg += '\n';
  }

  if (opts.branches.length > 0) {
    msg += '## Branches to Push\n\n';
    for (const branch of opts.branches) {
      msg += `- **${branch.branchName}** (task #${branch.taskId})\n`;
    }
    msg += '\n';
  } else {
    msg +=
      '## Branches\n\nNo code branches to push (workflow produced non-code output).\n\n';
  }

  msg += `## Trace Summary\n\n${opts.traceSummary}\n\n`;

  if (opts.existingPR) {
    msg += `## Existing Pull Request\n\n`;
    msg += `A PR already exists for the primary branch:\n`;
    msg += `- **URL**: ${opts.existingPR.url}\n`;
    msg += `- **Number**: #${opts.existingPR.number}\n`;
    msg += `- **State**: ${opts.existingPR.state}\n\n`;
  } else if (opts.branches.length > 0) {
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

  // Workflow outputs (review data, summaries, etc.)
  if (opts.workflowOutputs && Object.keys(opts.workflowOutputs).length > 0) {
    msg += '## Workflow Outputs\n\n';
    for (const [name, content] of Object.entries(opts.workflowOutputs)) {
      msg += `### Output: \`${name}\`\n\n`;
      msg += '```\n';
      msg += content;
      msg += '\n```\n\n';
    }
  }

  if (opts.branches.length > 0) {
    msg += '## Required Footer\n\n';
    msg +=
      'When creating a PR, you MUST append the following HTML block at the very end of the PR body. ';
    msg +=
      'This is used for automation tracking and must be included verbatim:\n\n';
    msg += '```html\n';
    msg += '<details>\n';
    msg += `${ROVER_FOOTER_MARKER}\n`;
    msg += '\n';
    msg += `Trace: \`${opts.traceId}\` | Action: \`${opts.actionId}\`\n`;
    msg += '\n';
    msg += '</details>\n';
    msg += '```\n\n';
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

    // Gather workflow outputs for non-code delivery
    const workflowProfile = meta.workflowProfile as
      | {
          description?: string;
          outputs: Array<{ name: string; type: string; filename?: string }>;
          inputs?: Array<{ name: string; type: string; description?: string }>;
        }
      | undefined;
    const workflowOutputs = gatherWorkflowOutputs(
      trace,
      store,
      project,
      workflowProfile
    );
    const hasWorkflowOutputs = Object.keys(workflowOutputs).length > 0;

    if (branches.length === 0 && !hasWorkflowOutputs) {
      const pushSpan = new SpanWriter(projectId, {
        step: 'push',
        parentId: pending.spanId,
        originAction: pending.actionId,
        meta: { error: 'no branches and no workflow outputs found' },
      });
      pushSpan.fail('push: no branches and no workflow outputs found');

      store.removePending(pending.actionId);

      return {
        spanId: pushSpan.id,
        terminal: true,
        enqueuedActions: [],
        reasoning: 'no branches and no workflow outputs found',
        status: 'failed',
      };
    }

    // Determine main branch
    const git = new Git({ cwd: projectPath });
    const mainBranch = git.getMainBranch();

    // Check for existing PR on the primary branch (only if branches exist)
    const primaryBranch = branches.length > 0 ? branches[0].branchName : null;
    const existingPR =
      owner && repo && primaryBranch
        ? await checkExistingPR(owner, repo, primaryBranch)
        : null;

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

    // ── Assistant mode: dry-run (skip AI invocation + push) ────────────
    if (ctx.mode === 'assistant') {
      const commands: string[] = [];
      if (branches.length > 0) {
        for (const branch of branches) {
          commands.push(`git push origin ${branch.branchName}`);
        }
        if (existingPR) {
          commands.push(`# PR already exists: ${existingPR.url}`);
        } else if (owner && repo && primaryBranch) {
          commands.push(
            `gh pr create --head ${primaryBranch} --base ${mainBranch} --fill --repo ${owner}/${repo}`
          );
        }
      } else if (hasWorkflowOutputs && eventMeta.prNumber && owner && repo) {
        // Non-code delivery: post review or comment
        commands.push(
          `gh api repos/${owner}/${repo}/pulls/${eventMeta.prNumber}/reviews --method POST --input -`
        );
      }

      const dryRunSummary =
        branches.length > 0
          ? branches.map(b => b.branchName).join(', ')
          : 'workflow output delivery';

      const pushSpan = new SpanWriter(projectId, {
        step: 'push',
        parentId: pending.spanId,
        originAction: pending.actionId,
        meta: {
          dryRun: true,
          commands,
          branches: branches.map(b => b.branchName),
          hasWorkflowOutputs,
        },
      });
      pushSpan.complete(`push (dry-run): ${dryRunSummary}`);
      store.removePending(pending.actionId);
      return {
        spanId: pushSpan.id,
        terminal: true,
        enqueuedActions: [],
        reasoning: `dry-run: ${commands.join('; ')}`,
      };
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
      traceId: pending.traceId,
      actionId: pending.actionId,
      workflowOutputs: hasWorkflowOutputs ? workflowOutputs : undefined,
      workflowProfile,
      workflowName: meta.workflow,
    });

    // Determine a working directory — use the first task's worktree if available
    const firstTask =
      branches.length > 0 ? project.getTask(branches[0].taskId) : null;
    const cwd = firstTask?.worktreePath ?? projectPath;

    // Build system prompt with custom instructions
    const systemPrompt = appendPromptSuffix(pushPromptTemplate, {
      projectPath,
      stepName: 'push',
    });

    // Invoke the AI agent
    const result = await invokeAI<PusherAIResult>({
      userMessage,
      systemPrompt,
      cwd,
      tools: ['Bash'],
    });

    // Build push span
    const succeeded = result.status !== 'failed';
    const pushSpanMeta: Record<string, any> = {
      deliveryStatus: result.status,
      branchesPushed: result.branches_pushed,
      pullRequest: result.pull_request,
      reviewPosted: result.review_posted ?? null,
      agentSummary: result.summary,
      ...(result.error ? { error: result.error } : {}),
    };

    const pushSpan = new SpanWriter(projectId, {
      step: 'push',
      parentId: pending.spanId,
      originAction: pending.actionId,
      meta: pushSpanMeta,
    });

    if (result.status === 'failed') {
      pushSpan.error(`push: failed: ${result.error ?? 'unknown error'}`);
    } else if (result.status === 'reviewed') {
      const prNum = result.review_posted?.pr_number;
      pushSpan.complete(
        `push: review posted${prNum ? ` on PR #${prNum}` : ''}`
      );
    } else if (result.status === 'delivered') {
      pushSpan.complete(`push: workflow output delivered`);
    } else {
      const prInfo = result.pull_request?.url
        ? ` (PR: ${result.pull_request.url})`
        : '';
      pushSpan.complete(`push: ${result.branches_pushed.join(', ')}${prInfo}`);
    }

    // Enqueue a notify action to complete the trace
    const notifyAction = emitAction(store, {
      projectId,
      traceId: pending.traceId,
      action: 'notify',
      spanId: pushSpan.id,
      reasoning: succeeded
        ? `Delivery completed: ${result.summary}`
        : `Delivery failed: ${result.error ?? 'unknown'}`,
      meta: {
        ...meta,
        deliveryStatus: result.status,
        branchesPushed: result.branches_pushed,
        pullRequestUrl: result.pull_request?.url ?? null,
        reviewPosted: result.review_posted ?? null,
      },
      fromStep: 'push',
      summary: succeeded
        ? `done: ${trace.summary}`
        : `push failed: ${trace.summary}`,
      removePendingId: pending.actionId,
    });

    const prUrl = result.pull_request?.url;
    let reasoning: string;
    if (result.status === 'failed') {
      reasoning = `push failed: ${result.error}`;
    } else if (result.status === 'reviewed') {
      reasoning = `review posted on PR #${result.review_posted?.pr_number ?? '?'}`;
    } else if (result.status === 'delivered') {
      reasoning = `workflow output delivered`;
    } else {
      reasoning = prUrl
        ? `pushed ${result.branches_pushed.join(', ')} — PR: ${prUrl}`
        : `pushed ${result.branches_pushed.join(', ')}`;
    }

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
