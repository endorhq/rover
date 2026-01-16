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
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk';

export class ClaudeACP implements Client {
  requestPermission(
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    console.error(
      '[Client] Request permission called with:',
      JSON.stringify(params, null, 2)
    );

    // Allow for now
    return Promise.resolve({
      outcome: {
        outcome: 'selected',
        optionId: 'allow',
      },
    });
  }
  async sessionUpdate(params: SessionNotification): Promise<void> {
    const update = params.update;

    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content.type === 'text') {
          process.stdout.write(update.content.text);
        } else {
          console.log(`[${update.content.type}]`);
        }
        break;
      case 'tool_call':
        console.log(`\n🔧 ${update.title} (${update.status})`);
        break;
      case 'tool_call_update':
        console.log(
          `\n🔧 Tool call \`${update.toolCallId}\` updated: ${update.status}\n`
        );
        break;
      case 'agent_thought_chunk':
        if (update.content.type === 'text') {
          console.log('[thinking...]', update.content.text);
        } else {
          console.log(`[${update.content.type}]`);
        }
        break;
      case 'plan':
      case 'user_message_chunk':
        console.log(`[${update.sessionUpdate}]`);
        break;
      default:
        console.log(
          `[Unknown session update: ${JSON.stringify(update, null, 2)}]`
        );
        break;
    }
  }
  writeTextFile?(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    console.error(
      '[Client] Write text file called with:',
      JSON.stringify(params, null, 2)
    );
    throw new Error('Method not implemented.');
  }
  readTextFile?(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    console.error(
      '[Client] Read text file called with:',
      JSON.stringify(params, null, 2)
    );

    return Promise.resolve({
      content: 'Mock file content',
    });
  }
  createTerminal?(
    params: CreateTerminalRequest
  ): Promise<CreateTerminalResponse> {
    console.error(
      '[Client] Create terminal called with:',
      JSON.stringify(params, null, 2)
    );
    throw new Error('Method not implemented.');
  }
  terminalOutput?(
    params: TerminalOutputRequest
  ): Promise<TerminalOutputResponse> {
    console.error(
      '[Client] Terminal output called with:',
      JSON.stringify(params, null, 2)
    );
    throw new Error('Method not implemented.');
  }
  releaseTerminal?(
    params: ReleaseTerminalRequest
  ): Promise<ReleaseTerminalResponse | void> {
    console.error(
      '[Client] Release terminal called with:',
      JSON.stringify(params, null, 2)
    );
    throw new Error('Method not implemented.');
  }
  waitForTerminalExit?(
    params: WaitForTerminalExitRequest
  ): Promise<WaitForTerminalExitResponse> {
    console.error(
      '[Client] Wait for terminal exit called with:',
      JSON.stringify(params, null, 2)
    );
    throw new Error('Method not implemented.');
  }
  killTerminal?(
    params: KillTerminalCommandRequest
  ): Promise<KillTerminalCommandResponse | void> {
    console.error(
      '[Client] Kill terminal called with:',
      JSON.stringify(params, null, 2)
    );
    throw new Error('Method not implemented.');
  }
  extMethod?(
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    console.error(
      '[Client] Ext method called with:',
      method,
      JSON.stringify(params, null, 2)
    );
    throw new Error('Method not implemented.');
  }
  extNotification?(
    method: string,
    params: Record<string, unknown>
  ): Promise<void> {
    console.error(
      '[Client] Ext notification called with:',
      method,
      JSON.stringify(params, null, 2)
    );
    throw new Error('Method not implemented.');
  }
}
