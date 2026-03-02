/**
 * Shared one-shot ACP invoke helper used by all CLI agents.
 *
 * Spawns the agent process, initializes an ACP connection, creates a session,
 * sends a prompt, captures the response, and cleans up.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type McpServer,
} from '@agentclientprotocol/sdk';
import colors from 'ansi-colors';
import { VERBOSE, ProjectConfigManager } from 'rover-core';
import type { MCP } from 'rover-schemas';
import { ACPClient } from './acp-client.js';
import { GeminiOrQwenACPClient } from './gemini-or-qwen-acp-client.js';

/**
 * Format an error into a human-readable string.
 */
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error !== null && typeof error === 'object') {
    return JSON.stringify(error, null, 2);
  }
  return String(error);
}

/** Whether the agent uses an npx bridge (model set via unstable_setSessionModel). */
type BridgeAgentConfig = {
  kind: 'bridge';
  command: string;
  args: string[];
};

/** Native ACP agent (model passed via CLI --model arg). */
type NativeAgentConfig = {
  kind: 'native';
  command: string;
  args: string[];
};

type AgentACPConfig = BridgeAgentConfig | NativeAgentConfig;

/**
 * Lookup table mapping each agent name to its ACP command / args.
 */
function getAgentACPConfig(agentName: string, model?: string): AgentACPConfig {
  switch (agentName) {
    case 'claude':
      return {
        kind: 'bridge',
        command: 'npx',
        args: ['-y', '@zed-industries/claude-agent-acp'],
      };
    case 'codex':
      return {
        kind: 'bridge',
        command: 'npx',
        args: ['-y', '@zed-industries/codex-acp'],
      };
    case 'cursor':
      return {
        kind: 'bridge',
        command: 'npx',
        args: ['-y', '@blowmage/cursor-agent-acp'],
      };
    case 'gemini': {
      const args = [
        '--experimental-acp',
        '--include-directories',
        '/',
        '--yolo',
      ];
      if (model) {
        args.push('--model', model);
      }
      if (VERBOSE) {
        args.push('--debug');
      }
      return { kind: 'native', command: 'gemini', args };
    }
    case 'qwen': {
      const args = ['--acp', '--include-directories', '/', '--yolo'];
      if (model) {
        args.push('--model', model);
      }
      if (VERBOSE) {
        args.push('--debug');
      }
      return { kind: 'native', command: 'qwen', args };
    }
    case 'copilot': {
      const args = ['--acp', '--allow-all-tools', '--silent'];
      if (model) {
        args.push('--model', model);
      }
      if (VERBOSE) {
        args.push('--log-level', 'all');
      }
      return { kind: 'native', command: 'copilot', args };
    }
    case 'opencode': {
      const args = ['acp', '--format', 'json'];
      if (model) {
        args.push('--model', model);
      }
      if (VERBOSE) {
        args.push('--verbose');
      }
      return { kind: 'native', command: 'opencode', args };
    }
    default:
      throw new Error(`Unknown agent for ACP: ${agentName}`);
  }
}

/**
 * Convert a rover.json MCP entry to an ACP McpServer object.
 */
function roverMcpToAcpServer(mcp: MCP): McpServer {
  const headerEntries = (mcp.headers || []).map(h => {
    const colonIdx = h.indexOf(':');
    if (colonIdx === -1) return { name: h.trim(), value: '' };
    return { name: h.slice(0, colonIdx).trim(), value: h.slice(colonIdx + 1).trim() };
  });

  const envEntries = (mcp.envs || []).map(e => {
    const eqIdx = e.indexOf('=');
    if (eqIdx === -1) return { name: e, value: '' };
    return { name: e.slice(0, eqIdx), value: e.slice(eqIdx + 1) };
  });

  switch (mcp.transport) {
    case 'http':
      return { type: 'http' as const, name: mcp.name, url: mcp.commandOrUrl, headers: headerEntries };
    case 'sse':
      return { type: 'sse' as const, name: mcp.name, url: mcp.commandOrUrl, headers: headerEntries };
    case 'stdio':
    default: {
      const parts = mcp.commandOrUrl.split(' ');
      return { name: mcp.name, command: parts[0], args: parts.slice(1), env: envEntries };
    }
  }
}

/**
 * Read MCP servers from rover.json at the given project path and convert them
 * to the ACP McpServer[] format.  Returns an empty array when no config exists.
 */
function loadMcpServersFromProject(projectPath: string): McpServer[] {
  try {
    if (!ProjectConfigManager.exists(projectPath)) return [];
    const config = ProjectConfigManager.load(projectPath);
    return config.mcps.map(roverMcpToAcpServer);
  } catch {
    return [];
  }
}

export interface ACPInvokeConfig {
  /** Agent name (claude, codex, cursor, gemini, qwen, copilot, opencode). */
  agentName: string;
  /** The prompt to send. */
  prompt: string;
  /** Working directory for the session. */
  cwd?: string;
  /** Model override (bridge agents use unstable_setSessionModel, native agents use CLI --model). */
  model?: string;
  /** MCP servers to pass to the ACP session.  When omitted, servers are auto-discovered from rover.json at `cwd`. */
  mcpServers?: McpServer[];
}

/**
 * One-shot ACP invocation: spawn agent -> init -> session -> prompt -> capture -> cleanup.
 *
 * Returns the captured agent response text.
 */
export async function acpInvoke(config: ACPInvokeConfig): Promise<string> {
  const { agentName, prompt, cwd, model } = config;
  const mcpServers = config.mcpServers ?? loadMcpServersFromProject(cwd || process.cwd());

  // Always include the built-in package-manager MCP
  mcpServers.push({
    type: 'http' as const,
    name: 'package-manager',
    url: 'http://127.0.0.1:8090/mcp',
    headers: [],
  });

  const agentConfig = getAgentACPConfig(agentName, model);

  console.log(
    colors.blue(
      `\n🚀 Starting ACP agent: ${agentConfig.command} ${agentConfig.args.join(' ')}`
    )
  );

  // 1. Spawn agent process
  const agentProcess: ChildProcess = spawn(
    agentConfig.command,
    agentConfig.args,
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    }
  );

  // Forward stderr for debugging
  if (agentProcess.stderr) {
    agentProcess.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      console.log(colors.yellow(`[ACP Agent stderr] ${text.trim()}`));
    });
  }

  if (!agentProcess.stdin || !agentProcess.stdout) {
    agentProcess.kill('SIGTERM');
    throw new Error('Failed to spawn agent process with proper I/O streams');
  }

  // 2. Create ACP client (agent-specific subclass when needed)
  let client: ACPClient;
  switch (agentName) {
    case 'gemini':
    case 'qwen':
      client = new GeminiOrQwenACPClient();
      break;
    default:
      client = new ACPClient();
      break;
  }

  // 3. Create streams and connection
  const input = Writable.toWeb(agentProcess.stdin);
  const output = Readable.toWeb(
    agentProcess.stdout
  ) as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(input, output);
  const connection = new ClientSideConnection(_agent => client, stream);

  try {
    // 4. Initialize connection (protocol handshake)
    const initRequest = {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
        terminal: true,
      },
    };

    console.log(
      colors.gray('[ACP] Sending initialize request:'),
      colors.cyan(JSON.stringify(initRequest, null, 2))
    );

    const initResult = await connection.initialize(initRequest);

    console.log(
      colors.green(
        `✅ Connected to agent (protocol v${initResult.protocolVersion})`
      )
    );

    // 5. Create session
    const sessionRequest = {
      cwd: cwd || process.cwd(),
      mcpServers,
    };

    console.log(
      colors.gray('[ACP] Sending newSession request:'),
      colors.cyan(JSON.stringify(sessionRequest, null, 2))
    );

    const sessionResult = await connection.newSession(sessionRequest);
    const sessionId = sessionResult.sessionId;

    console.log(colors.gray(`📝 Created session: ${sessionId}`));

    // 6. For bridge agents, set model via unstable_setSessionModel
    if (agentConfig.kind === 'bridge' && model) {
      await connection.unstable_setSessionModel({
        sessionId,
        modelId: model,
      });
      console.log(colors.gray(`🔄 Model changed to: ${model}`));
    }

    // 7. Send prompt and capture response
    client.startCapturing();

    console.log(
      colors.gray(
        `[ACP] Sending prompt request (prompt length: ${prompt.length} chars)`
      )
    );

    const promptResult = await connection.prompt({
      sessionId,
      prompt: [{ type: 'text', text: prompt }],
    });

    console.log(
      colors.gray('[ACP] Prompt response:'),
      colors.cyan(JSON.stringify(promptResult, null, 2))
    );

    const response = client.stopCapturing();

    return response;
  } catch (error) {
    console.log(colors.red('[ACP] Error:'), colors.red(formatError(error)));
    throw error;
  } finally {
    // 8. Cleanup: kill the agent process
    console.log(colors.gray('\n🔌 Closing ACP connection...'));
    agentProcess.kill('SIGTERM');
  }
}
