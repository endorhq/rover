import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { taskCommand } from '../../commands/task.js';
import { listCommand } from '../../commands/list.js';
import { inspectCommand } from '../../commands/inspect.js';
import { iterateCommand } from '../../commands/iterate.js';
import { logsCommand } from '../../commands/logs.js';
import { diffCommand } from '../../commands/diff.js';
import { mergeCommand } from '../../commands/merge.js';
import { pushCommand } from '../../commands/push.js';
import { restartCommand } from '../../commands/restart.js';
import { stopCommand } from '../../commands/stop.js';
import { deleteCommand } from '../../commands/delete.js';
import { shellCommand } from '../../commands/shell.js';

// Tool schemas for validation
const taskSchema = z.object({
  description: z.string().optional(),
  fromGithub: z.string().optional(),
  yes: z.boolean().optional(),
  sourceBranch: z.string().optional(),
  targetBranch: z.string().optional(),
  agent: z.enum(['claude', 'gemini', 'qwen']).optional(),
  json: z.boolean().optional(),
  debug: z.boolean().optional(),
});

const listSchema = z.object({
  watch: z.boolean().optional(),
  json: z.boolean().optional(),
});

const inspectSchema = z.object({
  taskId: z.string(),
  iterationNumber: z.number().optional(),
  file: z.array(z.string()).optional(),
  json: z.boolean().optional(),
});

const iterateSchema = z.object({
  taskId: z.string(),
  instructions: z.string().optional(),
  json: z.boolean().optional(),
});

const logsSchema = z.object({
  taskId: z.string(),
  iterationNumber: z.string().optional(),
  follow: z.boolean().optional(),
  json: z.boolean().optional(),
});

const diffSchema = z.object({
  taskId: z.string(),
  filePath: z.string().optional(),
  branch: z.string().optional(),
  onlyFiles: z.boolean().optional(),
});

const mergeSchema = z.object({
  taskId: z.string(),
  force: z.boolean().optional(),
  json: z.boolean().optional(),
});

const pushSchema = z.object({
  taskId: z.string(),
  message: z.string().optional(),
  json: z.boolean().optional(),
});

const restartSchema = z.object({
  taskId: z.string(),
  json: z.boolean().optional(),
});

const stopSchema = z.object({
  taskId: z.string(),
  removeAll: z.boolean().optional(),
  removeContainer: z.boolean().optional(),
  removeGitWorktreeAndBranch: z.boolean().optional(),
  json: z.boolean().optional(),
});

const deleteSchema = z.object({
  taskIds: z.array(z.string()),
  yes: z.boolean().optional(),
  json: z.boolean().optional(),
});

const shellSchema = z.object({
  taskId: z.string(),
  container: z.boolean().optional(),
});

// Tool definitions
export const roverTools: Tool[] = [
  {
    name: 'rover_task',
    description: 'Start a new task for an AI Agent. It will spawn a new environment to complete it.',
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'The task description',
        },
        fromGithub: {
          type: 'string',
          description: 'Fetch task description from a GitHub issue number',
        },
        yes: {
          type: 'boolean',
          description: 'Skip all confirmations and run non-interactively',
        },
        sourceBranch: {
          type: 'string',
          description: 'Base branch for git worktree creation',
        },
        targetBranch: {
          type: 'string',
          description: 'Custom name for the worktree branch',
        },
        agent: {
          type: 'string',
          enum: ['claude', 'gemini', 'qwen'],
          description: 'AI agent to use',
        },
        json: {
          type: 'boolean',
          description: 'Output the result in JSON format',
        },
        debug: {
          type: 'boolean',
          description: 'Show debug information like running commands',
        },
      },
    },
  },
  {
    name: 'rover_list',
    description: 'Show tasks and their status',
    inputSchema: {
      type: 'object',
      properties: {
        watch: {
          type: 'boolean',
          description: 'Watch for changes and refresh every 5 seconds',
        },
        json: {
          type: 'boolean',
          description: 'Output in JSON format',
        },
      },
    },
  },
  {
    name: 'rover_inspect',
    description: 'Inspect a task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to inspect',
        },
        iterationNumber: {
          type: 'string',
          description: 'Specific iteration number (defaults to latest)',
        },
        file: {
          type: 'array',
          items: { type: 'string' },
          description: 'Output iteration file contents',
        },
        json: {
          type: 'boolean',
          description: 'Output in JSON format',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'rover_iterate',
    description: 'Add instructions to a task and start new iteration',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to iterate on',
        },
        instructions: {
          type: 'string',
          description: 'New requirements or refinement instructions to apply',
        },
        json: {
          type: 'boolean',
          description: 'Output JSON and skip confirmation prompts',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'rover_logs',
    description: 'Show execution logs for a task iteration',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to show logs for',
        },
        iterationNumber: {
          type: 'string',
          description: 'Specific iteration number (defaults to latest)',
        },
        follow: {
          type: 'boolean',
          description: 'Follow log output in real-time',
        },
        json: {
          type: 'boolean',
          description: 'Output the result in JSON format',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'rover_diff',
    description: 'Show git diff between task worktree and main branch',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to show diff for',
        },
        filePath: {
          type: 'string',
          description: 'Optional file path to show diff for specific file',
        },
        branch: {
          type: 'string',
          description: 'Compare changes with a specific branch',
        },
        onlyFiles: {
          type: 'boolean',
          description: 'Show only changed filenames',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'rover_merge',
    description: 'Merge the task changes into your current branch',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to merge',
        },
        force: {
          type: 'boolean',
          description: 'Force merge without confirmation',
        },
        json: {
          type: 'boolean',
          description: 'Output in JSON format',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'rover_push',
    description: 'Commit and push task changes to remote, with GitHub PR support',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to push',
        },
        message: {
          type: 'string',
          description: 'Commit message',
        },
        json: {
          type: 'boolean',
          description: 'Output in JSON format',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'rover_restart',
    description: 'Restart a new or failed task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to restart',
        },
        json: {
          type: 'boolean',
          description: 'Output the result in JSON format',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'rover_stop',
    description: 'Stop a running task and clean up its resources',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to stop',
        },
        removeAll: {
          type: 'boolean',
          description: 'Remove container, git worktree and branch if they exist',
        },
        removeContainer: {
          type: 'boolean',
          description: 'Remove container if it exists',
        },
        removeGitWorktreeAndBranch: {
          type: 'boolean',
          description: 'Remove git worktree and branch',
        },
        json: {
          type: 'boolean',
          description: 'Output the result in JSON format',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'rover_delete',
    description: 'Delete a task',
    inputSchema: {
      type: 'object',
      properties: {
        taskIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task IDs to delete',
        },
        yes: {
          type: 'boolean',
          description: 'Skip all confirmations and run non-interactively',
        },
        json: {
          type: 'boolean',
          description: 'Output in JSON format',
        },
      },
      required: ['taskIds'],
    },
  },
  {
    name: 'rover_shell',
    description: 'Open interactive shell for testing task changes',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to open shell for',
        },
        container: {
          type: 'boolean',
          description: 'Start the interactive shell within a container',
        },
      },
      required: ['taskId'],
    },
  },
];

// Tool handlers
export async function handleToolCall(name: string, args: any): Promise<any> {
  try {
    switch (name) {
      case 'rover_task': {
        const parsed = taskSchema.parse(args);
        return await taskCommand(
          parsed.description,
          {
            fromGithub: parsed.fromGithub,
            yes: parsed.yes,
            sourceBranch: parsed.sourceBranch,
            targetBranch: parsed.targetBranch,
            agent: parsed.agent,
            json: parsed.json,
            debug: parsed.debug,
          }
        );
      }

      case 'rover_list': {
        const parsed = listSchema.parse(args);
        return await listCommand(parsed);
      }

      case 'rover_inspect': {
        const parsed = inspectSchema.parse(args);
        return await inspectCommand(
          parsed.taskId,
          parsed.iterationNumber,
          {
            file: parsed.file,
            json: parsed.json,
          }
        );
      }

      case 'rover_iterate': {
        const parsed = iterateSchema.parse(args);
        return await iterateCommand(
          parsed.taskId,
          parsed.instructions,
          { json: parsed.json }
        );
      }

      case 'rover_logs': {
        const parsed = logsSchema.parse(args);
        return await logsCommand(
          parsed.taskId,
          parsed.iterationNumber,
          {
            follow: parsed.follow,
            json: parsed.json,
          }
        );
      }

      case 'rover_diff': {
        const parsed = diffSchema.parse(args);
        return await diffCommand(
          parsed.taskId,
          parsed.filePath,
          {
            branch: parsed.branch,
            onlyFiles: parsed.onlyFiles,
          }
        );
      }

      case 'rover_merge': {
        const parsed = mergeSchema.parse(args);
        return await mergeCommand(
          parsed.taskId,
          {
            force: parsed.force,
            json: parsed.json,
          }
        );
      }

      case 'rover_push': {
        const parsed = pushSchema.parse(args);
        return await pushCommand(
          parsed.taskId,
          {
            message: parsed.message,
            json: parsed.json,
          }
        );
      }

      case 'rover_restart': {
        const parsed = restartSchema.parse(args);
        return await restartCommand(parsed.taskId, { json: parsed.json });
      }

      case 'rover_stop': {
        const parsed = stopSchema.parse(args);
        return await stopCommand(
          parsed.taskId,
          {
            removeAll: parsed.removeAll,
            removeContainer: parsed.removeContainer,
            removeGitWorktreeAndBranch: parsed.removeGitWorktreeAndBranch,
            json: parsed.json,
          }
        );
      }

      case 'rover_delete': {
        const parsed = deleteSchema.parse(args);
        return await deleteCommand(parsed.taskIds, {
          yes: parsed.yes,
          json: parsed.json,
        });
      }

      case 'rover_shell': {
        const parsed = shellSchema.parse(args);
        return await shellCommand(parsed.taskId, {
          container: parsed.container,
        });
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid arguments for ${name}: ${error.message}`);
    }
    throw error;
  }
}
