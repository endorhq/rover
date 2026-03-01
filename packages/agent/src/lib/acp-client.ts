import {
  Client,
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalCommandRequest,
  KillTerminalCommandResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestError,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  TerminalExitStatus,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import colors from 'ansi-colors';
import { execa, type ResultPromise } from 'execa';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { generateRandomId, VERBOSE } from 'rover-core';
import { formatError } from './format-error.js';

// Custom JSON replacer to handle BigInt values
function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return value;
}

interface TerminalState {
  process: ResultPromise;
  output: string;
  outputByteLimit: number | null;
  truncated: boolean;
  exitStatus: TerminalExitStatus | null;
  exitPromise: Promise<void>;
}

interface LegacyUsageUpdate {
  sessionUpdate: 'usage_update';
  cost?: {
    amount?: number;
    currency?: string;
  } | null;
}

const terminals = new Map<string, TerminalState>();

/**
 * Kill all tracked terminal processes and clear the map.
 * Called by ACPRunner.close() to prevent resource leaks.
 */
export function clearAllTerminals(): void {
  for (const state of terminals.values()) {
    if (state.exitStatus === null) {
      state.process.kill();
    }
  }
  terminals.clear();
}

function isLegacyUsageUpdate(update: unknown): update is LegacyUsageUpdate {
  if (update == null || typeof update !== 'object') {
    return false;
  }

  return (
    'sessionUpdate' in update &&
    (update as { sessionUpdate?: unknown }).sessionUpdate === 'usage_update'
  );
}

export class ACPClient implements Client {
  private capturedMessages: string = '';
  private isCapturing: boolean = false;

  // Cost tracking is best-effort. The installed SDK typings lag the runtime
  // protocol and omit usage_update, so we consume that event defensively.
  private cumulativeCostAmount: number = 0;
  private cumulativeCostCurrency: string = 'USD';
  private costAtCaptureStart: number = 0;

  /**
   * Start capturing agent messages from session updates
   */
  startCapturing(): void {
    this.capturedMessages = '';
    this.isCapturing = true;
    this.costAtCaptureStart = this.cumulativeCostAmount;
  }

  /**
   * Stop capturing and return accumulated messages
   */
  stopCapturing(): string {
    this.isCapturing = false;
    const messages = this.capturedMessages;
    this.capturedMessages = '';
    return messages;
  }

  /**
   * Get the cost incurred during the last capture window (between
   * startCapturing and stopCapturing). Returns the delta in the
   * cumulative cost reported by the agent when available.
   */
  getLastPromptCost(): { amount: number; currency: string } {
    return {
      amount: this.cumulativeCostAmount - this.costAtCaptureStart,
      currency: this.cumulativeCostCurrency,
    };
  }

  requestPermission(
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    if (VERBOSE) {
      console.log(
        colors.gray('[ACP] requestPermission called with:'),
        colors.cyan(JSON.stringify(params, jsonReplacer, 2))
      );
    }

    // Allow for now - use the first "allow" option from the provided options
    const allowOption =
      params.options.find(opt => opt.kind === 'allow_always') ??
      params.options.find(opt => opt.kind === 'allow_once');

    if (!allowOption) {
      console.log(
        colors.red('[ACP] requestPermission: No allow option found!')
      );
      throw new Error('No allow option found in permission request');
    }

    const response: RequestPermissionResponse = {
      outcome: {
        outcome: 'selected',
        optionId: allowOption.optionId,
      },
    };

    if (VERBOSE) {
      console.log(
        colors.gray('[ACP] requestPermission response:'),
        colors.green(JSON.stringify(response, jsonReplacer, 2))
      );
    }

    return Promise.resolve(response);
  }

  async sessionUpdate(params: SessionNotification): Promise<void> {
    const rawUpdate = params.update as unknown;

    if (VERBOSE) {
      const sessionUpdate =
        rawUpdate &&
        typeof rawUpdate === 'object' &&
        'sessionUpdate' in rawUpdate
          ? String((rawUpdate as { sessionUpdate?: unknown }).sessionUpdate)
          : 'unknown';
      console.log(
        colors.gray(`[ACP] sessionUpdate: ${sessionUpdate}`),
        colors.cyan(
          JSON.stringify(rawUpdate, jsonReplacer, 2).substring(0, 500)
        )
      );
    }

    if (isLegacyUsageUpdate(rawUpdate)) {
      const amount = rawUpdate.cost?.amount;
      if (typeof amount === 'number' && Number.isFinite(amount)) {
        this.cumulativeCostAmount = amount;
      }

      if (
        typeof rawUpdate.cost?.currency === 'string' &&
        rawUpdate.cost.currency
      ) {
        this.cumulativeCostCurrency = rawUpdate.cost.currency;
      }

      return;
    }

    const update = params.update;

    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content.type === 'text') {
          // Capture agent messages when capturing is enabled
          if (this.isCapturing) {
            this.capturedMessages += update.content.text;
          }
          if (VERBOSE) {
            process.stdout.write(update.content.text);
          }
        } else {
          if (VERBOSE) {
            console.log(colors.gray(`[${update.content.type}]`));
          }
        }
        break;
      case 'tool_call':
        if (VERBOSE) {
          console.log(
            colors.gray(
              `[ACP] tool_call: ${update.title} (${update.status}) ID: `
            ) + colors.cyan(update.toolCallId)
          );
        }
        if (!VERBOSE && update.status === 'in_progress') {
          process.stdout.write(colors.gray(`⚙️  ${update.title}`));
        }
        break;
      case 'tool_call_update':
        if (VERBOSE) {
          const statusStr = update.status ? `status: ${update.status}` : '';
          const titleStr = update.title ? `title: ${update.title}` : '';
          const parts = [statusStr, titleStr].filter(Boolean).join(', ');
          console.log(
            colors.gray(`[ACP] tool_call_update: `) +
              colors.cyan(update.toolCallId) +
              colors.gray(parts ? ` - ${parts}` : '')
          );
        }
        if (!VERBOSE) {
          if (update.status === 'completed') {
            process.stdout.write(colors.green('.'));
          } else if (update.status === 'failed') {
            process.stdout.write(colors.red('.'));
          }
        }
        break;
      case 'agent_thought_chunk':
        if (VERBOSE) {
          if (update.content.type === 'text') {
            console.log(colors.gray('[thinking...]'), update.content.text);
          } else {
            console.log(colors.gray(`[${update.content.type}]`));
          }
        }

        if (this.isCapturing && update.content.type === 'text') {
          this.capturedMessages += `[THINKING] ${update.content.text}`;
        }
        break;
      case 'available_commands_update':
      case 'plan':
      case 'user_message_chunk':
      case 'current_mode_update':
      case 'config_option_update':
      case 'session_info_update':
        // Already logged above
        break;
      default: {
        const exhaustiveCheck: never = update;
        console.log(
          colors.yellow(
            `[ACP] Unknown session update: ${JSON.stringify(exhaustiveCheck, jsonReplacer, 2)}`
          )
        );
        break;
      }
    }
  }

  writeTextFile?(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    if (VERBOSE) {
      console.log(
        colors.gray('[ACP] writeTextFile called with:'),
        colors.cyan(JSON.stringify(params, jsonReplacer, 2))
      );
    }

    try {
      // Create parent directories if they don't exist
      const parentDir = dirname(params.path);
      mkdirSync(parentDir, { recursive: true });

      writeFileSync(params.path, params.content);

      if (VERBOSE) {
        console.log(
          colors.green(
            `[ACP] writeTextFile: Successfully wrote to ${params.path}`
          )
        );
      }
      return Promise.resolve({});
    } catch (error) {
      console.log(
        colors.red(`[ACP] writeTextFile error:`),
        colors.red(formatError(error))
      );
      throw error;
    }
  }

  /**
   * Called when readTextFile encounters a file that does not exist.
   * Subclasses can override this to customize behavior per agent.
   * By default, throws a resourceNotFound error.
   */
  protected onFileNotFound(path: string): Promise<ReadTextFileResponse> {
    throw RequestError.resourceNotFound(path);
  }

  /**
   * Format a directory listing for when readTextFile is called on a directory.
   * Returns a text listing with file/directory indicators so the agent can
   * pick the right file to read next.
   */
  private formatDirectoryListing(dirPath: string): string {
    try {
      const entries = readdirSync(dirPath).sort();
      const lines = entries.map(name => {
        try {
          const stat = statSync(`${dirPath}/${name}`);
          return stat.isDirectory() ? `${name}/` : name;
        } catch {
          return name;
        }
      });
      return `Directory listing for ${dirPath}:\n\n${lines.join('\n')}`;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (VERBOSE) {
        console.log(
          colors.yellow(
            `[ACP] formatDirectoryListing failed for ${dirPath}: ${msg}`
          )
        );
      }
      return `Error listing directory ${dirPath}: ${msg}`;
    }
  }

  readTextFile?(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    if (VERBOSE) {
      console.log(
        colors.gray('[ACP] readTextFile called with:'),
        colors.cyan(JSON.stringify(params, jsonReplacer, 2))
      );
    }

    let content: string;
    try {
      content = readFileSync(params.path, 'utf-8');
      if (VERBOSE) {
        console.log(
          colors.green(
            `[ACP] readTextFile: Read ${content.length} bytes from ${params.path}`
          )
        );
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        if (error.code === 'ENOENT') {
          if (VERBOSE) {
            console.log(
              colors.yellow(`[ACP] readTextFile: File not found ${params.path}`)
            );
          }
          return this.onFileNotFound(params.path);
        }
        if (error.code === 'EISDIR') {
          if (VERBOSE) {
            console.log(
              colors.yellow(
                `[ACP] readTextFile: Path is a directory, returning listing for ${params.path}`
              )
            );
          }
          return Promise.resolve({
            content: this.formatDirectoryListing(params.path),
          });
        }
      }
      console.log(
        colors.red(`[ACP] readTextFile error:`),
        colors.red(formatError(error))
      );
      throw error;
    }

    if (params.line) {
      content = content.split('\n')[params.line - 1] || '';
    }

    if (params.limit) {
      content = content.split('\n').slice(0, params.limit).join('\n');
    }

    const response = { content };
    if (VERBOSE) {
      console.log(
        colors.gray('[ACP] readTextFile response:'),
        colors.cyan(
          `{ content: "${content.length > 100 ? content.substring(0, 100) + '...' : content}" }`
        )
      );
    }
    return Promise.resolve(response);
  }

  createTerminal?(
    params: CreateTerminalRequest
  ): Promise<CreateTerminalResponse> {
    if (VERBOSE) {
      console.log(
        colors.gray('[ACP] createTerminal called with:'),
        colors.cyan(JSON.stringify(params, jsonReplacer, 2))
      );
    }

    const terminalId = `terminal-${generateRandomId()}`;

    // Convert env array to object, filtering out undefined values
    const envObj: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        envObj[key] = value;
      }
    }
    if (params.env) {
      for (const { name, value } of params.env) {
        envObj[name] = value;
      }
    }

    // When args are explicitly provided, pass them directly to execa
    // to avoid shell injection. When only a command string is given,
    // use bash -c so shell features (pipes, redirections) still work.
    let childProcess;

    if (params.args && params.args.length > 0) {
      childProcess = execa(params.command, params.args, {
        cwd: params.cwd ?? undefined,
        env: envObj,
        reject: false,
        all: true,
      });
    } else {
      childProcess = execa('bash', ['-c', params.command], {
        cwd: params.cwd ?? undefined,
        env: envObj,
        reject: false,
        all: true,
      });
    }

    const state: TerminalState = {
      process: childProcess,
      output: '',
      outputByteLimit:
        params.outputByteLimit !== undefined
          ? Number(params.outputByteLimit)
          : null,
      truncated: false,
      exitStatus: null,
      exitPromise: Promise.resolve(),
    };

    // Capture combined stdout/stderr
    if (childProcess.all) {
      childProcess.all.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        state.output += text;

        // Apply byte limit with truncation from the beginning (O(n) approach)
        if (
          state.outputByteLimit !== null &&
          Buffer.byteLength(state.output, 'utf-8') > state.outputByteLimit
        ) {
          state.truncated = true;
          // Convert to Buffer, keep the last outputByteLimit bytes, decode back.
          const buf = Buffer.from(state.output, 'utf-8');
          let start = buf.length - state.outputByteLimit;
          // Skip past any UTF-8 continuation bytes (0x80-0xBF) at the cut
          // point to avoid slicing in the middle of a multi-byte character.
          while (start < buf.length && (buf[start] & 0xc0) === 0x80) {
            start++;
          }
          state.output = buf.subarray(start).toString('utf-8');
          // Skip past the first partial line for a clean boundary
          const firstNewline = state.output.indexOf('\n');
          if (firstNewline !== -1 && firstNewline < state.output.length / 2) {
            state.output = state.output.slice(firstNewline + 1);
          }
        }
      });
    }

    // Set up exit promise
    state.exitPromise = childProcess.then(result => {
      state.exitStatus = {
        exitCode: result.exitCode ?? null,
        signal: result.signal ?? null,
      };
    });

    terminals.set(terminalId, state);

    return Promise.resolve({ terminalId });
  }

  terminalOutput?(
    params: TerminalOutputRequest
  ): Promise<TerminalOutputResponse> {
    if (VERBOSE) {
      console.log(
        colors.gray('[ACP] terminalOutput called with:'),
        colors.cyan(JSON.stringify(params, jsonReplacer, 2))
      );
    }

    const state = terminals.get(params.terminalId);
    if (!state) {
      console.log(
        colors.red(
          `[ACP] terminalOutput: Terminal not found: ${params.terminalId}`
        )
      );
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    const response = {
      output: state.output,
      truncated: state.truncated,
      exitStatus: state.exitStatus,
    };
    if (VERBOSE) {
      console.log(
        colors.gray(
          '[ACP] terminalOutput response (output length: ' +
            state.output.length +
            ' chars)'
        ),
        colors.cyan(
          JSON.stringify(
            { ...response, output: '[truncated]' },
            jsonReplacer,
            2
          )
        )
      );
    }
    return Promise.resolve(response);
  }

  releaseTerminal?(
    params: ReleaseTerminalRequest
  ): Promise<ReleaseTerminalResponse | void> {
    if (VERBOSE) {
      console.log(
        colors.gray('[ACP] releaseTerminal called with:'),
        colors.cyan(JSON.stringify(params, jsonReplacer, 2))
      );
    }

    const state = terminals.get(params.terminalId);
    if (!state) {
      console.log(
        colors.red(
          `[ACP] releaseTerminal: Terminal not found: ${params.terminalId}`
        )
      );
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    if (VERBOSE) {
      console.log('Terminal output:');
      console.log(colors.gray(state.output || 'No output'));
    }

    // Kill the process if still running
    if (state.exitStatus === null) {
      if (VERBOSE) {
        console.log(
          colors.gray(
            `[ACP] releaseTerminal: Killing process for ${params.terminalId}`
          )
        );
      }
      state.process.kill();
    }

    // Remove from tracking
    terminals.delete(params.terminalId);
    if (VERBOSE) {
      console.log(
        colors.green(`[ACP] releaseTerminal: Released ${params.terminalId}`)
      );
    }

    return Promise.resolve({});
  }

  async waitForTerminalExit?(
    params: WaitForTerminalExitRequest
  ): Promise<WaitForTerminalExitResponse> {
    if (VERBOSE) {
      console.log(
        colors.gray('[ACP] waitForTerminalExit called with:'),
        colors.cyan(JSON.stringify(params, jsonReplacer, 2))
      );
    }

    const state = terminals.get(params.terminalId);
    if (!state) {
      console.log(
        colors.red(
          `[ACP] waitForTerminalExit: Terminal not found: ${params.terminalId}`
        )
      );
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    // Wait for the process to exit
    if (VERBOSE) {
      console.log(
        colors.gray(
          `[ACP] waitForTerminalExit: Waiting for ${params.terminalId}...`
        )
      );
    }
    await state.exitPromise;

    const response = {
      exitCode: state.exitStatus?.exitCode ?? null,
      signal: state.exitStatus?.signal ?? null,
    };
    if (VERBOSE) {
      console.log(
        colors.gray('[ACP] waitForTerminalExit response:'),
        colors.cyan(JSON.stringify(response, jsonReplacer, 2))
      );
    }
    return response;
  }

  killTerminal?(
    params: KillTerminalCommandRequest
  ): Promise<KillTerminalCommandResponse | void> {
    if (VERBOSE) {
      console.log(
        colors.gray('[ACP] killTerminal called with:'),
        colors.cyan(JSON.stringify(params, jsonReplacer, 2))
      );
    }

    const state = terminals.get(params.terminalId);
    if (!state) {
      console.log(
        colors.red(
          `[ACP] killTerminal: Terminal not found: ${params.terminalId}`
        )
      );
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    // Kill the process (sends SIGTERM by default)
    state.process.kill();
    if (VERBOSE) {
      console.log(
        colors.green(`[ACP] killTerminal: Killed ${params.terminalId}`)
      );
    }

    return Promise.resolve({});
  }

  extMethod?(
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (VERBOSE) {
      console.log(
        colors.yellow('[ACP] extMethod called (not implemented):'),
        colors.cyan(method),
        colors.cyan(JSON.stringify(params, jsonReplacer, 2))
      );
    }
    throw new Error('Method not implemented.');
  }

  extNotification?(
    method: string,
    params: Record<string, unknown>
  ): Promise<void> {
    if (VERBOSE) {
      console.log(
        colors.yellow('[ACP] extNotification called (not implemented):'),
        colors.cyan(method),
        colors.cyan(JSON.stringify(params, jsonReplacer, 2))
      );
    }
    throw new Error('Method not implemented.');
  }
}
