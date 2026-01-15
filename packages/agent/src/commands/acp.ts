import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { ClaudeACP } from '../lib/acp/claude.js';
import { CodexACP } from '../lib/acp/codex.js';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  Client,
} from '@agentclientprotocol/sdk';

/**
 * Agent configurations for ACP
 */
const AGENT_CONFIGS = {
  claude: {
    command: 'npx',
    args: ['-y', '@zed-industries/claude-code-acp'],
    client: () => new ClaudeACP(),
  },
  codex: {
    command: 'npx',
    args: ['-y', '@zed-industries/codex-acp'],
    client: () => new CodexACP(),
  },
  gemini: {
    command: 'npx',
    args: ['-y', '@google/gemini-cli@0.17.1', '--experimental-acp'],
    client: () => new ClaudeACP(), // Reuse ClaudeACP for now
  },
  qwen: {
    command: 'qwen',
    args: ['--experimental-acp'],
    client: () => new ClaudeACP(), // Reuse ClaudeACP for now
  },
};

type AgentType = keyof typeof AGENT_CONFIGS;

/**
 * Experimental ACP integration.
 */
export const acpCommand = async (agent: AgentType = 'claude') => {
  const agentConfig = AGENT_CONFIGS[agent];
  if (!agentConfig) {
    console.error(
      `Unknown agent: ${agent}. Available agents: ${Object.keys(AGENT_CONFIGS).join(', ')}`
    );
    process.exit(1);
  }

  console.log(`Spawning ${agent} agent`);
  const agentProcess = spawn(agentConfig.command, agentConfig.args, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: process.env,
  });

  // Create streams to communicate with the agent
  const input = Writable.toWeb(agentProcess.stdin!);
  const output = Readable.toWeb(
    agentProcess.stdout!
  ) as ReadableStream<Uint8Array>;

  // Create the client connection
  console.log('Connecting agent');
  const client = agentConfig.client();
  const stream = ndJsonStream(input, output);
  const connection = new ClientSideConnection(_agent => client, stream);

  try {
    // Initialize the connection
    const initResult = await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
      },
    });

    console.log(
      `✅ Connected to agent (protocol v${initResult.protocolVersion})`
    );

    // Create a new session
    const sessionResult = await connection.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    });

    console.log(`📝 Created session: ${sessionResult.sessionId}`);
    console.log(
      `💬 User: run cat command to read the README.md file in this repository!\n`
    );
    process.stdout.write(' ');

    // Send a test prompt
    const promptResult = await connection.prompt({
      sessionId: sessionResult.sessionId,
      prompt: [
        {
          type: 'text',
          text: 'run cat command to read the README.md file in this repository. Do not use your read tool, but use explicit shell cat command only. Return me a summary.',
        },
      ],
    });

    console.log(`\n\n✅ Agent completed with: ${promptResult.stopReason}`);

    const followUp = await connection.prompt({
      sessionId: sessionResult.sessionId,
      prompt: [
        {
          type: 'text',
          text: 'Summarize it in a single phrase',
        },
      ],
    });

    console.log(`\n\n✅ Agent completed with: ${followUp.stopReason}`);
  } catch (error) {
    console.error('[Client] Error:', error);
  } finally {
    agentProcess.kill();
    process.exit(0);
  }
};
