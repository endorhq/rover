import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { listCommand } from '../commands/list.js';
import { taskCommand } from '../commands/task.js';
import { initCommand } from '../commands/init.js';
import { diffCommand } from '../commands/diff.js';
import { logsCommand } from '../commands/logs.js';
import { shellCommand } from '../commands/shell.js';
import { pushCommand } from '../commands/push.js';
import { mergeCommand } from '../commands/merge.js';
import { deleteCommand } from '../commands/delete.js';
import { inspectCommand } from '../commands/inspect.js';
import { iterateCommand } from '../commands/iterate.js';
import { restartCommand } from '../commands/restart.js';
import { resetCommand } from '../commands/reset.js';
import { stopCommand } from '../commands/stop.js';
import { z } from 'zod';

/**
 * Start an MCP server
 */
export const mcpCommand = async (
  taskId: string,
  options: {
    json?: boolean;
    removeAll?: boolean;
    removeContainer?: boolean;
    removeGitWorktreeAndBranch?: boolean;
  } = {}
) => {
  const server = new McpServer({
    name: 'rover',
    version: '1.0.0',
  });

  const runCommand = async (
    command: (...args: any[]) => void,
    args: any = {}
  ) => {
    const oldConsoleLog = console.log;
    let commandOutput = '';
    console.log = function (...args) {
      commandOutput +=
        args
          .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
          .join(' ') + '\n';
    };
    await command({ ...args, json: true });
    console.log = oldConsoleLog;
    return {
      content: [
        {
          type: 'text' as const,
          text: commandOutput,
        },
      ],
    };
  };

  server.registerTool(
    'list-tasks',
    {
      title: 'List tasks',
      description: 'List Rover tasks in the current project',
      inputSchema: {},
    },
    async () => {
      return runCommand(listCommand);
    }
  );

  // Task command schema
  const taskSchema = z.object({
    initPrompt: z.string().optional(),
    fromGithub: z.string().optional(),
    yes: z.boolean().optional(),
    sourceBranch: z.string().optional(),
    targetBranch: z.string().optional(),
    agent: z.enum(['claude', 'codex', 'gemini', 'qwen']).optional(),
    debug: z.boolean().optional(),
  });

  server.registerTool(
    'task',
    {
      title: 'Create task',
      description: 'Create a new Rover task for AI agents to work on',
      inputSchema: {
        type: 'object',
        properties: {
          initPrompt: {
            type: 'string',
            description: 'Initial task description or prompt'
          },
          fromGithub: {
            type: 'string',
            description: 'GitHub issue URL or number to create task from'
          },
          yes: {
            type: 'boolean',
            description: 'Skip confirmations and use defaults'
          },
          sourceBranch: {
            type: 'string',
            description: 'Source branch for the task'
          },
          targetBranch: {
            type: 'string',
            description: 'Target branch name for the task'
          },
          agent: {
            type: 'string',
            enum: ['claude', 'codex', 'gemini', 'qwen'],
            description: 'AI agent to use for the task'
          },
          debug: {
            type: 'boolean',
            description: 'Enable debug mode'
          }
        }
      }
    },
    async (args) => {
      const parsed = taskSchema.parse(args);
      return runCommand(taskCommand, parsed.initPrompt, {
        fromGithub: parsed.fromGithub,
        yes: parsed.yes,
        sourceBranch: parsed.sourceBranch,
        targetBranch: parsed.targetBranch,
        agent: parsed.agent,
        json: true,
        debug: parsed.debug,
      });
    }
  );

  // Init command schema
  const initSchema = z.object({
    path: z.string().optional(),
    yes: z.boolean().optional(),
  });

  server.registerTool(
    'init',
    {
      title: 'Initialize project',
      description: 'Initialize Rover in a project directory',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Project path to initialize (defaults to current directory)'
          },
          yes: {
            type: 'boolean',
            description: 'Skip confirmations and use defaults'
          }
        }
      }
    },
    async (args) => {
      const parsed = initSchema.parse(args);
      return runCommand(initCommand, parsed.path || '.', {
        yes: parsed.yes,
      });
    }
  );

  // Diff command schema
  const diffSchema = z.object({
    taskId: z.string(),
    filePath: z.string().optional(),
    onlyFiles: z.boolean().optional(),
    branch: z.string().optional(),
  });

  server.registerTool(
    'diff',
    {
      title: 'Show task diff',
      description: 'Show code changes made by a task',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'Task ID to show diff for'
          },
          filePath: {
            type: 'string',
            description: 'Specific file path to show diff for'
          },
          onlyFiles: {
            type: 'boolean',
            description: 'Show only changed filenames'
          },
          branch: {
            type: 'string',
            description: 'Branch to compare against'
          }
        },
        required: ['taskId']
      }
    },
    async (args) => {
      const parsed = diffSchema.parse(args);
      return runCommand(diffCommand, parsed.taskId, parsed.filePath, {
        onlyFiles: parsed.onlyFiles,
        branch: parsed.branch,
      });
    }
  );

  // Logs command schema
  const logsSchema = z.object({
    taskId: z.string(),
    iterationNumber: z.string().optional(),
    follow: z.boolean().optional(),
  });

  server.registerTool(
    'logs',
    {
      title: 'Show task logs',
      description: 'Show execution logs for a task',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'Task ID to show logs for'
          },
          iterationNumber: {
            type: 'string',
            description: 'Specific iteration number to show logs for'
          },
          follow: {
            type: 'boolean',
            description: 'Follow logs in real-time'
          }
        },
        required: ['taskId']
      }
    },
    async (args) => {
      const parsed = logsSchema.parse(args);
      return runCommand(logsCommand, parsed.taskId, parsed.iterationNumber, {
        follow: parsed.follow,
        json: true,
      });
    }
  );

  // Shell command schema
  const shellSchema = z.object({
    taskId: z.string(),
    container: z.boolean().optional(),
  });

  server.registerTool(
    'shell',
    {
      title: 'Open task shell',
      description: 'Open an interactive shell in task workspace',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'Task ID to open shell for'
          },
          container: {
            type: 'boolean',
            description: 'Open shell in Docker container'
          }
        },
        required: ['taskId']
      }
    },
    async (args) => {
      const parsed = shellSchema.parse(args);
      return runCommand(shellCommand, parsed.taskId, {
        container: parsed.container,
      });
    }
  );

  // Push command schema
  const pushSchema = z.object({
    taskId: z.string(),
    message: z.string().optional(),
    pr: z.boolean().optional(),
  });

  server.registerTool(
    'push',
    {
      title: 'Push task changes',
      description: 'Commit and push task changes to remote repository',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'Task ID to push changes for'
          },
          message: {
            type: 'string',
            description: 'Custom commit message'
          },
          pr: {
            type: 'boolean',
            description: 'Create a pull request after pushing'
          }
        },
        required: ['taskId']
      }
    },
    async (args) => {
      const parsed = pushSchema.parse(args);
      return runCommand(pushCommand, parsed.taskId, {
        message: parsed.message,
        pr: parsed.pr,
        json: true,
      });
    }
  );

  // Merge command schema
  const mergeSchema = z.object({
    taskId: z.string(),
    message: z.string().optional(),
    squash: z.boolean().optional(),
  });

  server.registerTool(
    'merge',
    {
      title: 'Merge task',
      description: 'Merge completed task back to main branch',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'Task ID to merge'
          },
          message: {
            type: 'string',
            description: 'Custom merge commit message'
          },
          squash: {
            type: 'boolean',
            description: 'Squash commits during merge'
          }
        },
        required: ['taskId']
      }
    },
    async (args) => {
      const parsed = mergeSchema.parse(args);
      return runCommand(mergeCommand, parsed.taskId, {
        message: parsed.message,
        squash: parsed.squash,
        json: true,
      });
    }
  );

  // Delete command schema
  const deleteSchema = z.object({
    taskIds: z.array(z.string()),
    yes: z.boolean().optional(),
  });

  server.registerTool(
    'delete',
    {
      title: 'Delete tasks',
      description: 'Delete one or more tasks and their resources',
      inputSchema: {
        type: 'object',
        properties: {
          taskIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of task IDs to delete'
          },
          yes: {
            type: 'boolean',
            description: 'Skip confirmation prompt'
          }
        },
        required: ['taskIds']
      }
    },
    async (args) => {
      const parsed = deleteSchema.parse(args);
      return runCommand(deleteCommand, parsed.taskIds, {
        json: true,
        yes: parsed.yes,
      });
    }
  );

  // Inspect command schema
  const inspectSchema = z.object({
    taskId: z.string(),
    files: z.boolean().optional(),
  });

  server.registerTool(
    'inspect',
    {
      title: 'Inspect task',
      description: 'Show detailed information about a task',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'Task ID to inspect'
          },
          files: {
            type: 'boolean',
            description: 'Include list of files in task workspace'
          }
        },
        required: ['taskId']
      }
    },
    async (args) => {
      const parsed = inspectSchema.parse(args);
      return runCommand(inspectCommand, parsed.taskId, {
        files: parsed.files,
        json: true,
      });
    }
  );

  // Iterate command schema
  const iterateSchema = z.object({
    taskId: z.string(),
    instructions: z.string().optional(),
    agent: z.enum(['claude', 'codex', 'gemini', 'qwen']).optional(),
    debug: z.boolean().optional(),
  });

  server.registerTool(
    'iterate',
    {
      title: 'Iterate task',
      description: 'Add a new iteration to an existing task with additional instructions',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'Task ID to iterate on'
          },
          instructions: {
            type: 'string',
            description: 'Additional instructions for the iteration'
          },
          agent: {
            type: 'string',
            enum: ['claude', 'codex', 'gemini', 'qwen'],
            description: 'AI agent to use for this iteration'
          },
          debug: {
            type: 'boolean',
            description: 'Enable debug mode'
          }
        },
        required: ['taskId']
      }
    },
    async (args) => {
      const parsed = iterateSchema.parse(args);
      return runCommand(iterateCommand, parsed.taskId, parsed.instructions, {
        agent: parsed.agent,
        json: true,
        debug: parsed.debug,
      });
    }
  );

  // Restart command schema
  const restartSchema = z.object({
    taskId: z.string(),
  });

  server.registerTool(
    'restart',
    {
      title: 'Restart task',
      description: 'Restart a failed or new task',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'Task ID to restart'
          }
        },
        required: ['taskId']
      }
    },
    async (args) => {
      const parsed = restartSchema.parse(args);
      return runCommand(restartCommand, parsed.taskId, {
        json: true,
      });
    }
  );

  // Reset command schema
  const resetSchema = z.object({
    taskId: z.string(),
    force: z.boolean().optional(),
  });

  server.registerTool(
    'reset',
    {
      title: 'Reset task',
      description: 'Reset a task to its initial state, removing all progress',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'Task ID to reset'
          },
          force: {
            type: 'boolean',
            description: 'Skip confirmation prompt'
          }
        },
        required: ['taskId']
      }
    },
    async (args) => {
      const parsed = resetSchema.parse(args);
      return runCommand(resetCommand, parsed.taskId, {
        force: parsed.force,
      });
    }
  );

  // Stop command schema
  const stopSchema = z.object({
    taskId: z.string(),
    removeAll: z.boolean().optional(),
    removeContainer: z.boolean().optional(),
    removeGitWorktreeAndBranch: z.boolean().optional(),
  });

  server.registerTool(
    'stop',
    {
      title: 'Stop task',
      description: 'Stop a running task and clean up its resources',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'Task ID to stop'
          },
          removeAll: {
            type: 'boolean',
            description: 'Remove all task resources'
          },
          removeContainer: {
            type: 'boolean',
            description: 'Remove Docker container'
          },
          removeGitWorktreeAndBranch: {
            type: 'boolean',
            description: 'Remove Git worktree and branch'
          }
        },
        required: ['taskId']
      }
    },
    async (args) => {
      const parsed = stopSchema.parse(args);
      return runCommand(stopCommand, parsed.taskId, {
        json: true,
        removeAll: parsed.removeAll,
        removeContainer: parsed.removeContainer,
        removeGitWorktreeAndBranch: parsed.removeGitWorktreeAndBranch,
      });
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
};
