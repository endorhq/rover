import { Client, CreateTerminalRequest, CreateTerminalResponse, KillTerminalCommandRequest, KillTerminalCommandResponse, ReadTextFileRequest, ReadTextFileResponse, ReleaseTerminalRequest, ReleaseTerminalResponse, RequestPermissionRequest, RequestPermissionResponse, SessionNotification, TerminalOutputRequest, TerminalOutputResponse, WaitForTerminalExitRequest, WaitForTerminalExitResponse, WriteTextFileRequest, WriteTextFileResponse } from "@agentclientprotocol/sdk";
import { readFileSync, writeFileSync } from "node:fs";

export class ACPClient implements Client {
  requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    console.log("[Client] Request permission called with:", JSON.stringify(params, null, 2));

    // Allow for now
    return Promise.resolve({
      outcome: {
        outcome: "selected",
        optionId: "allow_always"
      }
    })
  }
  async sessionUpdate(params: SessionNotification): Promise<void> {
    const update = params.update;

    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        if (update.content.type === "text") {
          process.stdout.write(update.content.text);
        } else {
          console.log(`[${update.content.type}]`);
        }
        break;
      case "tool_call":
        console.log(`🔧 ${update.title} (${update.status}) ID: ${update.toolCallId}`);
        break;
      case "tool_call_update":
        console.log(
          `🔧 Update: \`${update.toolCallId}\` updated: ${update.status} title: ${update.title}\n`,
        );
        break;
      case "agent_thought_chunk":
        if (update.content.type === "text") {
          console.log('[thinking...]', update.content.text);
        } else {
          console.log(`[${update.content.type}]`);
        }
        break;
      case "plan":
      case "user_message_chunk":
        console.log(`[${update.sessionUpdate}]`);
        break;
      default:
        console.log(`[Unknown session update: ${JSON.stringify(update, null, 2)}]`);
        break;
    }
  }
  writeTextFile?(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    console.log("[Client] Write text file called with:", JSON.stringify(params, null, 2));
    writeFileSync(params.path, params.content);
    return Promise.resolve({});
  }
  readTextFile?(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    console.log(
      "[Client] Read text file called with:",
      JSON.stringify(params, null, 2),
    );

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
  createTerminal?(params: CreateTerminalRequest): Promise<CreateTerminalResponse> {
    console.error("[Client] Create terminal called with:", JSON.stringify(params, null, 2));
    throw new Error("Method not implemented.");
  }
  terminalOutput?(params: TerminalOutputRequest): Promise<TerminalOutputResponse> {
    console.error("[Client] Terminal output called with:", JSON.stringify(params, null, 2));
    throw new Error("Method not implemented.");
  }
  releaseTerminal?(params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse | void> {
    console.error("[Client] Release terminal called with:", JSON.stringify(params, null, 2));
    throw new Error("Method not implemented.");
  }
  waitForTerminalExit?(params: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> {
    console.error("[Client] Wait for terminal exit called with:", JSON.stringify(params, null, 2));
    throw new Error("Method not implemented.");
  }
  killTerminal?(params: KillTerminalCommandRequest): Promise<KillTerminalCommandResponse | void> {
    console.error("[Client] Kill terminal called with:", JSON.stringify(params, null, 2));
    throw new Error("Method not implemented.");
  }
  extMethod?(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    console.error("[Client] Ext method called with:", method, JSON.stringify(params, null, 2));
    throw new Error("Method not implemented.");
  }
  extNotification?(method: string, params: Record<string, unknown>): Promise<void> {
    console.error("[Client] Ext notification called with:", method, JSON.stringify(params, null, 2));
    throw new Error("Method not implemented.");
  }

}