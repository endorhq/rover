import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import listCmd from '../commands/list.js';
import taskCmd from '../commands/task.js';
import initCmd from '../commands/init.js';
import diffCmd from '../commands/diff.js';
import logsCmd from '../commands/logs.js';
import pushCmd from '../commands/push.js';
import mergeCmd from '../commands/merge.js';
import deleteCmd from '../commands/delete.js';
import inspectCmd from '../commands/inspect.js';
import iterateCmd from '../commands/iterate.js';
import restartCmd from '../commands/restart.js';
import resetCmd from '../commands/reset.js';
import stopCmd from '../commands/stop.js';
import { AI_AGENT } from 'rover-core';
import { z } from 'zod';
import type { CommandDefinition } from '../types.js';

/**
 * Start Rover as a Model Context Protocol (MCP) server.
 *
 * Exposes Rover's functionality through the MCP protocol, allowing AI assistants
 * and other MCP clients to interact with Rover programmatically. Supports all
 * core commands (task creation, inspection, logs, diff, merge, push, etc.) as
 * MCP tools. Adapts to project mode or global mode based on the CLI context.
 */
const mcpCommand = async () => {
  const server = new McpServer({
    name: 'rover',
    version: '1.0.0',
  });

  const runCommand = async (
    command: (...args: any[]) => void,
    args: any = [],
    options: any = {}
  ) => {
    const oldConsoleLog = console.log;
    const oldProcessExit = process.exit;
    let commandOutput = '';

    console.log = (...args) => {
      commandOutput +=
        args
          .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
          .join(' ') + '\n';
    };

    class ExceptionAsProcessExit extends Error {
      code?: number;

      constructor(code?: number) {
        super();

        this.code = code;
      }
    }

    // Intercept process.exit calls to prevent actual exit
    process.exit = ((code?: number) => {
      // Don't actually exit, just throw an exception that we catch
      throw new ExceptionAsProcessExit(code);
    }) as any;

    try {
      await command(...args, { ...options, json: true });
    } finally {
      // Always restore the original functions
      console.log = oldConsoleLog;
      process.exit = oldProcessExit;
    }

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
      return runCommand(listCmd.action);
    }
  );

  // Task command schema
  const taskSchema = z.object({
    initPrompt: z.string(),
    fromGithub: z.string().optional(),
    includeComments: z.boolean().optional(),
    sourceBranch: z.string().optional(),
    targetBranch: z.string().optional(),
    agent: z.nativeEnum(AI_AGENT).optional(),
    // New context fields
    context: z.array(z.string()).optional(),
    contextTrustAuthors: z.string().optional(),
    contextTrustAllAuthors: z.boolean().optional(),
  });

  server.registerTool(
    'create-task',
    {
      title: 'Create task',
      description:
        'Create a new Rover task for AI agents to work on. Supports GitHub and GitLab context (e.g., github:issue/15, gitlab:mr/42).',
      inputSchema: taskSchema.shape,
    },
    async args => {
      const parsed = taskSchema.parse(args);
      return runCommand(taskCmd.action, [parsed.initPrompt], {
        fromGithub: parsed.fromGithub,
        includeComments: parsed.includeComments,
        yes: true,
        sourceBranch: parsed.sourceBranch,
        targetBranch: parsed.targetBranch,
        agent: parsed.agent,
        context: parsed.context,
        contextTrustAuthors: parsed.contextTrustAuthors,
        contextTrustAllAuthors: parsed.contextTrustAllAuthors,
        debug: false,
      });
    }
  );

  // Init command schema
  server.registerTool(
    'init',
    {
      title: 'Initialize project',
      description: 'Initialize Rover in the current directory',
      inputSchema: {},
    },
    async args => {
      return runCommand(initCmd.action, ['.'], {
        yes: true,
      });
    }
  );

  // Diff command schema
  const diffSchema = z.object({
    taskId: z.string(),
    filePath: z.string().optional(),
    onlyFiles: z.array(z.string()).optional(),
    branch: z.string().optional(),
  });

  server.registerTool(
    'diff',
    {
      title: 'Show task diff',
      description: 'Show code changes made by a task',
      inputSchema: diffSchema.shape,
    },
    async args => {
      const parsed = diffSchema.parse(args);
      return runCommand(diffCmd.action, [parsed.taskId, parsed.filePath], {
        onlyFiles: parsed.onlyFiles,
        branch: parsed.branch,
      });
    }
  );

  // Logs command schema
  const logsSchema = z.object({
    taskId: z.string(),
    iterationNumber: z.string().optional(),
  });

  server.registerTool(
    'logs',
    {
      title: 'Show task logs',
      description: 'Show execution logs for a task',
      inputSchema: logsSchema.shape,
    },
    async args => {
      const parsed = logsSchema.parse(args);
      return runCommand(logsCmd.action, [
        parsed.taskId,
        parsed.iterationNumber,
      ]);
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
      inputSchema: pushSchema.shape,
    },
    async args => {
      const parsed = pushSchema.parse(args);
      return runCommand(pushCmd.action, [parsed.taskId], {
        message: parsed.message,
        pr: parsed.pr,
      });
    }
  );

  // Merge command schema
  const mergeSchema = z.object({
    taskId: z.string(),
  });

  server.registerTool(
    'merge',
    {
      title: 'Merge task',
      description: 'Merge completed task back to main branch',
      inputSchema: mergeSchema.shape,
    },
    async args => {
      const parsed = mergeSchema.parse(args);
      return runCommand(mergeCmd.action, [parsed.taskId]);
    }
  );

  // Delete command schema
  const deleteSchema = z.object({
    taskIds: z.array(z.string()),
  });

  server.registerTool(
    'delete',
    {
      title: 'Delete tasks',
      description: 'Delete one or more tasks and their resources',
      inputSchema: deleteSchema.shape,
    },
    async args => {
      const parsed = deleteSchema.parse(args);
      return runCommand(deleteCmd.action, [parsed.taskIds], {
        yes: true,
      });
    }
  );

  // Inspect command schema
  const inspectSchema = z.object({
    taskId: z.string(),
    iterationNumber: z.string().optional(),
    files: z.array(z.string()).optional(),
  });

  server.registerTool(
    'inspect',
    {
      title: 'Inspect task',
      description: 'Show detailed information about a task',
      inputSchema: inspectSchema.shape,
    },
    async args => {
      const parsed = inspectSchema.parse(args);
      return runCommand(
        inspectCmd.action,
        [parsed.taskId, parsed.iterationNumber],
        {
          file: parsed.files,
        }
      );
    }
  );

  // Iterate command schema
  const iterateSchema = z.object({
    taskId: z.string(),
    instructions: z.string().optional(),
    // New context fields
    context: z.array(z.string()).optional(),
    contextTrustAuthors: z.string().optional(),
    contextTrustAllAuthors: z.boolean().optional(),
  });

  server.registerTool(
    'iterate',
    {
      title: 'Iterate task',
      description:
        'Add a new iteration to an existing task with additional instructions. Supports GitHub and GitLab context (e.g., github:issue/15, gitlab:mr/42).',
      inputSchema: iterateSchema.shape,
    },
    async args => {
      const parsed = iterateSchema.parse(args);
      return runCommand(
        iterateCmd.action,
        [parsed.taskId, parsed.instructions],
        {
          context: parsed.context,
          contextTrustAuthors: parsed.contextTrustAuthors,
          contextTrustAllAuthors: parsed.contextTrustAllAuthors,
        }
      );
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
      inputSchema: restartSchema.shape,
    },
    async args => {
      const parsed = restartSchema.parse(args);
      return runCommand(restartCmd.action, [parsed.taskId]);
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
      inputSchema: resetSchema.shape,
    },
    async args => {
      const parsed = resetSchema.parse(args);
      return runCommand(resetCmd.action, [parsed.taskId], {
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
      inputSchema: stopSchema.shape,
    },
    async args => {
      const parsed = stopSchema.parse(args);
      return runCommand(stopCmd.action, [parsed.taskId], {
        removeAll: parsed.removeAll,
        removeContainer: parsed.removeContainer,
        removeGitWorktreeAndBranch: parsed.removeGitWorktreeAndBranch,
      });
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
};

export default {
  name: 'mcp',
  description: 'Start Rover as an MCP server',
  requireProject: false,
  action: mcpCommand,
} satisfies CommandDefinition;
