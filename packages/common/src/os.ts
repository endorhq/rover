import { execa, execaSync } from 'execa';

import type { Options, SyncOptions } from 'execa';

import colors from 'ansi-colors';

import { VERBOSE } from './index.js';

const log = (stream: string) => {
  return function* (chunk: unknown) {
    const data = String(chunk);
    const now = new Date();
    if (process.stderr.isTTY) {
      console.error(
        colors.gray(now.toISOString()) +
        ' ' +
        colors.cyan(stream) +
        ' ' +
        colors.gray(data)
      );
    } else {
      console.error(`${now.toISOString()} ${stream} ${data}`);
    }
    yield chunk;
  };
};

const logStdout = log('stdout');
const logStderr = log('stderr');

export function launch(
  command: string,
  args?: ReadonlyArray<string>,
  options?: Options
): ReturnType<typeof execa> {
  if (VERBOSE) {
    const stdout = options?.stdout
      ? [options.stdout as any, logStdout]
      : [logStdout];
    const stderr = options?.stderr
      ? [options.stderr as any, logStderr]
      : [logStderr];
    return execa(command, args, {
      ...options,
      stdout: stdout as any,
      stderr: stderr as any,
    });
  }
  return execa(command, args, options);
}

export function launchSync(
  command: string,
  args?: ReadonlyArray<string>,
  options?: SyncOptions
): ReturnType<typeof execaSync> {
  if (VERBOSE) {
    const stdout = options?.stdout
      ? [options.stdout as any, logStdout]
      : [logStdout];
    const stderr = options?.stderr
      ? [options.stderr as any, logStderr]
      : [logStderr];
    return execaSync(command, args, {
      ...options,
      stdout: stdout as any,
      stderr: stderr as any,
    });
  }
  return execaSync(command, args, options);
}
