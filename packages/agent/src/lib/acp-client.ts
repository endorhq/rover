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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generateRandomId, VERBOSE } from 'rover-core';

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

  /**
   * Start capturing agent messages from session updates
   */
  startCapturing(): void {
    this.capturedMessages = '';
    this.isCapturing = true;
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

  requestPermission(
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    if (VERBOSE) {
      console.log(
        colors.gray('[Client] Request permission called with:'),
        colors.cyan(JSON.stringify(params, jsonReplacer, 2))
      );
    }

    // Allow for now - use the optionId from the 'allow_always' option in the request
    const allowAlwaysOption = params.options.find(
      opt => opt.kind === 'allow_always'
    );
    const optionId = allowAlwaysOption?.optionId ?? 'always';

    return Promise.resolve({
      outcome: {
        outcome: 'selected',
        optionId,
      },
    });
  }

  async sessionUpdate(params: SessionNotification): Promise<void> {
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
            colors.gray(`🔧 ${update.title} (${update.status}) ID: `) +
              colors.cyan(update.toolCallId)
          );
        } else if (update.status === 'in_progress') {
          process.stdout.write(colors.gray(`⚙️  ${update.title}`));
        }
        break;
      case 'tool_call_update':
        if (VERBOSE) {
          const statusStr = update.status ? `status: ${update.status}` : '';
          const titleStr = update.title ? `title: ${update.title}` : '';
          const parts = [statusStr, titleStr].filter(Boolean).join(', ');
          console.log(
            colors.gray(`🔧 Update: `) +
              colors.cyan(update.toolCallId) +
              colors.gray(parts ? ` - ${parts}` : '')
          );
        } else if (update.status === 'completed') {
          process.stdout.write(colors.green('.'));
        } else if (update.status === 'failed') {
          process.stdout.write(colors.red('.'));
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
        if (VERBOSE) {
          console.log(colors.gray(`[${update.sessionUpdate}]`));
        }
        break;
      default: {
        const exhaustiveCheck: never = update;
        if (VERBOSE) {
          console.log(
            colors.yellow(
              `[Unknown session update: ${JSON.stringify(exhaustiveCheck, jsonReplacer, 2)}]`
            )
          );
        }
        break;
      }
    }
  }

  writeTextFile?(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    if (VERBOSE) {
      console.log(
        colors.gray('[Client] Write text file called with:'),
        colors.cyan(JSON.stringify(params, jsonReplacer, 2))
      );
    }
    writeFileSync(params.path, params.content);
    return Promise.resolve({});
  }

  readTextFile?(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    if (VERBOSE) {
      console.log(
        colors.gray('[Client] Read text file called with:'),
        colors.cyan(JSON.stringify(params, jsonReplacer, 2))
      );
    }

    // Some ACP servers (e.g. Qwen, Gemini) issue a read_text_file before
    // every write_text_file, likely to diff against existing content. When
    // writing a new file the read would fail with ENOENT, which the server
    // treats as a failed write — causing it to fall back to shell commands.
    // Return empty content for non-existent files so the subsequent write
    // can proceed normally.
    if (!existsSync(params.path)) {
      return Promise.resolve({ content: '' });
    }

    let content = readFileSync(params.path, 'utf-8');

    if (params.line) {
      content = content.split('\n')[params.line - 1] || '';
    }

    if (params.limit) {
      content = content.split('\n').slice(0, params.limit).join('\n');
    }

    return Promise.resolve({
      content,
    });
  }

  createTerminal?(
    params: CreateTerminalRequest
  ): Promise<CreateTerminalResponse> {
    if (VERBOSE) {
      console.log(
        colors.gray('[Client] Create terminal called with:'),
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
        colors.gray('[Client] Terminal output called with:'),
        colors.cyan(JSON.stringify(params, jsonReplacer, 2))
      );
    }

    const state = terminals.get(params.terminalId);
    if (!state) {
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    return Promise.resolve({
      output: state.output,
      truncated: state.truncated,
      exitStatus: state.exitStatus,
    });
  }

  releaseTerminal?(
    params: ReleaseTerminalRequest
  ): Promise<ReleaseTerminalResponse | void> {
    if (VERBOSE) {
      console.log(
        colors.gray('[Client] Release terminal called with:'),
        colors.cyan(JSON.stringify(params, jsonReplacer, 2))
      );
    }

    const state = terminals.get(params.terminalId);

    if (VERBOSE) {
      console.log('Terminal output:');
      console.log(colors.gray(state?.output || 'No output'));
    }

    if (!state) {
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    // Kill the process if still running
    if (state.exitStatus === null) {
      state.process.kill();
    }

    // Remove from tracking
    terminals.delete(params.terminalId);

    return Promise.resolve({});
  }

  async waitForTerminalExit?(
    params: WaitForTerminalExitRequest
  ): Promise<WaitForTerminalExitResponse> {
    if (VERBOSE) {
      console.log(
        colors.gray('[Client] Wait for terminal exit called with:'),
        colors.cyan(JSON.stringify(params, jsonReplacer, 2))
      );
    }

    const state = terminals.get(params.terminalId);
    if (!state) {
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    // Wait for the process to exit
    await state.exitPromise;

    return {
      exitCode: state.exitStatus?.exitCode ?? null,
      signal: state.exitStatus?.signal ?? null,
    };
  }

  killTerminal?(
    params: KillTerminalCommandRequest
  ): Promise<KillTerminalCommandResponse | void> {
    if (VERBOSE) {
      console.log(
        colors.gray('[Client] Kill terminal called with:'),
        colors.cyan(JSON.stringify(params, jsonReplacer, 2))
      );
    }

    const state = terminals.get(params.terminalId);
    if (!state) {
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    // Kill the process (sends SIGTERM by default)
    state.process.kill();

    return Promise.resolve({});
  }

  extMethod?(
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    console.error(
      colors.red('[Client] Ext method called with:'),
      colors.cyan(method),
      colors.cyan(JSON.stringify(params, jsonReplacer, 2))
    );
    throw new Error('Method not implemented.');
  }

  extNotification?(
    method: string,
    params: Record<string, unknown>
  ): Promise<void> {
    console.error(
      colors.red('[Client] Ext notification called with:'),
      colors.cyan(method),
      colors.cyan(JSON.stringify(params, jsonReplacer, 2))
    );
    throw new Error('Method not implemented.');
  }
}
