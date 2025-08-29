import {
  execa,
  execaSync,
  ExecaError,
  Options,
  Result,
  ResultPromise,
  SyncOptions,
  SyncResult,
} from "execa";

import type {
  LaunchOptions,
  LaunchSyncOptions,
} from "./types.d.ts";

import colors from 'ansi-colors';

import { VERBOSE } from './index.ts';

const log = (stream: string) => {
  return function* (data: string) {
      const now = new Date();
      if (process.stderr.isTTY) {
          console.error(colors.gray(now.toISOString()) + ' ' + colors.cyan(stream) + ' ' + colors.gray(data));
      } else {
          console.error(`${now.toISOString()} ${stream} ${data}`);
      }
      yield data
  }
}

const logStdout = log('stdout');
const logStderr = log('stderr');

export async function launch(
    command: string,
    args?: ReadonlyArray<string>,
    options?: Options,
): Promise<Result> {
    let stdout = options?.stdout;
    let stderr = options?.stderr;
    if (VERBOSE) {
        stdout = stdout ? [...Array(stdout), logStdout] : [logStdout];
        stderr = stderr ? [...Array(stderr), logStderr] : [logStderr];
    }
    return execa(command, args, {
      ...options,
      stdout,
      stderr,
    } as Options);
}

export function launchSync(
    command: string,
    args?: ReadonlyArray<string>,
    options?: Options,
): SyncResult {
    let stdout = options?.stdout;
    let stderr = options?.stderr;
    if (VERBOSE) {
        stdout = stdout ? [...Array(stdout), logStdout] : [logStdout];
        stderr = stderr ? [...Array(stderr), logStderr] : [logStderr];
    }
    return execaSync(command, args, {
      ...options,
      stdout,
      stderr,
    } as SyncOptions);
}
