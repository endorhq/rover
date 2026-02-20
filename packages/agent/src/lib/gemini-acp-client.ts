import type { ReadTextFileResponse } from '@agentclientprotocol/sdk';
import colors from 'ansi-colors';
import { ACPClient } from './acp-client.js';

/**
 * Gemini-specific ACP client.
 *
 * Gemini's write_file tool internally reads the target file before writing.
 * When the file does not exist the ACP error object is surfaced as
 * "[object Object]" which confuses the model. Returning empty content
 * instead lets the write proceed normally.
 */
export class GeminiACPClient extends ACPClient {
  protected override onFileNotFound(
    path: string
  ): Promise<ReadTextFileResponse> {
    console.log(
      colors.yellow(
        `[ACP] readTextFile: Returning empty content for missing file ${path} (Gemini)`
      )
    );
    return Promise.resolve({ content: '' });
  }
}
