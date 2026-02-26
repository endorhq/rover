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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateRandomId, VERBOSE } from 'rover-core';

/**
 * Format an error into a human-readable string.
 * Handles Error instances, plain objects (e.g. JSON-RPC errors), and primitives.
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

const terminals = new Map<string, TerminalState>();

export class ACPClient implements Client {
  private capturedMessages: string = '';
  private isCapturing: boolean = false;

  // Cost tracking: cumulative cost reported by the agent via usage_update events
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
   * cumulative cost reported by the agent via usage_update events.
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
    const update = params.update;

    if (VERBOSE) {
      console.log(
        colors.gray(`[ACP] sessionUpdate: ${update.sessionUpdate}`),
        colors.cyan(JSON.stringify(update, jsonReplacer, 2).substring(0, 500))
      );
    }

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
      case 'usage_update':
        // Track cumulative cost reported by the agent
        if (update.cost) {
          this.cumulativeCostAmount = update.cost.amount;
          this.cumulativeCostCurrency = update.cost.currency;
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
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        if (VERBOSE) {
          console.log(
            colors.yellow(`[ACP] readTextFile: File not found ${params.path}`)
          );
        }
        return this.onFileNotFound(params.path);
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

    // Split command into executable and arguments if args not provided
    let command: string;

    if (params.args && params.args.length > 0) {
      // Args explicitly provided, use command as-is
      command = `${params.command} ${params.args}`;
    } else {
      command = params.command;
    }

    const childProcess = execa('bash', ['-c', command], {
      cwd: params.cwd ?? undefined,
      env: envObj,
      reject: false,
      all: true,
    });

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

        // Apply byte limit with truncation from the beginning
        if (
          state.outputByteLimit !== null &&
          Buffer.byteLength(state.output, 'utf-8') > state.outputByteLimit
        ) {
          state.truncated = true;
          // Truncate from the beginning to stay within limit
          while (
            Buffer.byteLength(state.output, 'utf-8') > state.outputByteLimit
          ) {
            // Remove characters from the beginning until we're under the limit
            // Find a character boundary to avoid breaking multi-byte characters
            const idx = state.output.indexOf('\n');
            if (idx !== -1 && idx < state.output.length / 2) {
              // Remove up to the first newline for cleaner truncation
              state.output = state.output.slice(idx + 1);
            } else {
              // Remove one character at a time
              state.output = state.output.slice(1);
            }
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

    if (VERBOSE) {
      console.log('Terminal output:');
      console.log(colors.gray(state?.output || 'No output'));
    }

    if (!state) {
      console.log(
        colors.red(
          `[ACP] releaseTerminal: Terminal not found: ${params.terminalId}`
        )
      );
      throw new Error(`Terminal not found: ${params.terminalId}`);
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
