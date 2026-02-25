import type { ReadTextFileResponse } from '@agentclientprotocol/sdk';
import colors from 'ansi-colors';
import { VERBOSE } from 'rover-core';
import { ACPClient } from './acp-client.js';

/**
 * Gemini/Qwen-specific ACP client.
 *
 * Both Gemini's and Qwen's write_file tool internally reads the target file
 * before writing. When the file does not exist the ACP error object is
 * surfaced as "[object Object]" which confuses the model. Returning empty
 * content instead lets the write proceed normally.
 */
export class GeminiOrQwenACPClient extends ACPClient {
  protected override onFileNotFound(
    path: string
  ): Promise<ReadTextFileResponse> {
    if (VERBOSE) {
      console.log(
        colors.yellow(
          `[ACP] readTextFile: Returning empty content for missing file ${path} (Gemini/Qwen)`
        )
      );
    }
    return Promise.resolve({ content: '' });
  }
}
