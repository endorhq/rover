import { execa, execaSync } from 'execa';

import type {
  Options,
  Result,
  SyncOptions,
  SyncResult,
  StdoutStderrOption,
} from 'execa';
export type { Options, Result, SyncOptions, SyncResult };

import colors from 'ansi-colors';
import { Git } from './git.js';

import { PROJECT_CONFIG_FILE, VERBOSE } from './index.js';

export type LaunchOptions = Options & {
  mightLogSensitiveInformation?: boolean;
};

export type LaunchSyncOptions = SyncOptions & {
  mightLogSensitiveInformation?: boolean;
};

/**
 * Find the project root directory by searching for rover.json in parent directories
 * up to the Git repository root
 */
export function findProjectRoot(): string {
  const git = new Git();
  return git.getRepositoryRoot() || process.cwd();
}

const log = (stream: string) => {
  return (options: { mightLogSensitiveInformation?: boolean }) => {
    return function* (chunk: unknown) {
      let data;
      if (options.mightLogSensitiveInformation) {
        data = '**** redacted output ****';
      } else {
        data = String(chunk);
      }
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
};

const logStdout = log('stdout');
const logStderr = log('stderr');

/**
 * Check if the given stream requires to print logging.
 * We skip logging for inherit streams
 */
const shouldAddLogging = (stream: string, options?: Options | SyncOptions) => {
  if (options == null) return true;

  if (options.all) {
    // Merging all streams into a single one
    const stdioArrayInherit =
      Array.isArray(options.stdio) &&
      options.stdio.some(el => el === 'inherit');
    const stdioInherit =
      !Array.isArray(options.stdio) && options.stdio === 'inherit';

    // Do not add logging if the stdio has an inherit value
    return !(stdioArrayInherit || stdioInherit);
  }

  const streamOpts = stream === 'stdout' ? options.stdout : options.stderr;
  const streamArrayInherit =
    Array.isArray(streamOpts) && streamOpts.some(el => el === 'inherit');
  const streamInherit = !Array.isArray(streamOpts) && streamOpts === 'inherit';

  // Do not add logging if the stream has an inherit value
  return !(streamArrayInherit || streamInherit);
};

export function launch(
  command: string,
  args?: ReadonlyArray<string>,
  options?: LaunchOptions
): ReturnType<typeof execa> {
  if (VERBOSE) {
    const now = new Date();
    console.error(
      colors.gray(now.toISOString()) +
        colors.cyan(' Command ') +
        colors.gray(`${command} ${args?.join(' ')}`)
    );

    // Check first if we need to add logging
    let newOpts: Options = {
      ...options,
    } as Options;

    if (shouldAddLogging('stdout', options)) {
      const stdout = options?.stdout
        ? [
            logStdout({
              mightLogSensitiveInformation:
                options?.mightLogSensitiveInformation,
            }),
            options.stdout,
          ].flat()
        : [
            logStdout({
              mightLogSensitiveInformation:
                options?.mightLogSensitiveInformation,
            }),
          ];

      newOpts = {
        ...newOpts,
        stdout,
      } as Options;
    }

    if (shouldAddLogging('stderr', options)) {
      const stderr = options?.stderr
        ? [
            logStderr({
              mightLogSensitiveInformation:
                options?.mightLogSensitiveInformation,
            }),
            options.stderr,
          ].flat()
        : [
            logStderr({
              mightLogSensitiveInformation:
                options?.mightLogSensitiveInformation,
            }),
          ];

      newOpts = {
        ...newOpts,
        stderr,
      } as Options;
    }

    return execa(command, args, newOpts);
  }

  return execa(command, args, options);
}

export function launchSync(
  command: string,
  args?: ReadonlyArray<string>,
  options?: LaunchSyncOptions
): ReturnType<typeof execaSync> {
  if (VERBOSE) {
    const now = new Date();
    console.error(
      colors.gray(now.toISOString()) +
        colors.cyan(' Command ') +
        colors.gray(`${command} ${args?.join(' ')}`)
    );

    // Check first if we need to add logging
    let newOpts: SyncOptions = {
      ...options,
    } as SyncOptions;

    if (shouldAddLogging('stdout', options)) {
      const stdout = options?.stdout
        ? [
            logStdout({
              mightLogSensitiveInformation:
                options?.mightLogSensitiveInformation,
            }),
            options.stdout,
          ].flat()
        : [
            logStdout({
              mightLogSensitiveInformation:
                options?.mightLogSensitiveInformation,
            }),
          ];

      newOpts = {
        ...newOpts,
        stdout,
      } as SyncOptions;
    }

    if (shouldAddLogging('stderr', options)) {
      const stderr = options?.stderr
        ? [
            logStderr({
              mightLogSensitiveInformation:
                options?.mightLogSensitiveInformation,
            }),
            options.stderr,
          ].flat()
        : [
            logStderr({
              mightLogSensitiveInformation:
                options?.mightLogSensitiveInformation,
            }),
          ];

      newOpts = {
        ...newOpts,
        stderr,
      } as SyncOptions;
    }

    return execaSync(command, args, newOpts);
  }
  return execaSync(command, args, options);
}
