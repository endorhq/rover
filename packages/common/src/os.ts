import { execa, execaSync, parseCommandString } from 'execa';

import type { Options, Result, SyncOptions, SyncResult } from 'execa';
export type { Options, Result, SyncOptions, SyncResult };

import colors from 'ansi-colors';
import { Git } from './git.js';

import { VERBOSE } from './index.js';

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

/**
 * Run a specific command with the arguments and return an object with the result.
 * The command and args get converted in the a template string for proper escaping.
 *
 * Initially, we were passing a command + args[] to the execa method, but it was
 * causing some escaping error. For example, if you pass:
 *
 * npx binary -- another-command test
 *
 * Using execa('npx', ['binary', '--', 'another-command', 'test']), the argument after
 * -- gets incorrectly quoted: npx binary -- 'another-command test'.
 *
 * To avoid this issue, we use the parseCommandString + template strings.
 *
 * We found another corner case related to environment variables options like
 * `-e ENV=VALUE`. Execa escapes the 'ENV=VALUE' string regardless you use options
 * like { shell: true }. For those, you must use the long syntax: `--env=ENV=VALUE`.
 *
 * @see https://github.com/sindresorhus/execa/blob/main/docs/escaping.md
 * @see https://github.com/sindresorhus/execa/blob/main/docs/shell.md
 *
 * @param command the command to run
 * @param args arguments to pass to the command
 * @param options Execa options to modify the behavior of the spawn
 * @returns An Execa object with the result
 */
export function launch(
  command: string,
  args?: ReadonlyArray<string>,
  options?: LaunchOptions
): ReturnType<typeof execa> {
  const argsWithSpacing = (args || [])
    .map(arg => {
      return arg.replaceAll(' ', '\\ ');
    })
    .join(' ');
  const parsedCommand = parseCommandString(`${command} ${argsWithSpacing}`);

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

    // Use template string as array format quotes arguments even when using shell
    return execa(newOpts)`${parsedCommand}`;
  }

  if (options) {
    return execa(options)`${parsedCommand}`;
  } else {
    return execa`${parsedCommand}`;
  }
}

/**
 * Run a specific command with the arguments and return an object with the result.
 * The command and args get converted in the a template string for proper escaping.
 * All this process run synchronously.
 *
 * Initially, we were passing a command + args[] to the execa method, but it was
 * causing some escaping error. For example, if you pass:
 *
 * npx binary -- another-command test
 *
 * Using execa('npx', ['binary', '--', 'another-command', 'test']), the argument after
 * -- gets incorrectly quoted: npx binary -- 'another-command test'.
 *
 * To avoid this issue, we use the parseCommandString + template strings.
 *
 * We found another corner case related to environment variables options like
 * `-e ENV=VALUE`. Execa escapes the 'ENV=VALUE' string regardless you use options
 * like { shell: true }. For those, you must use the long syntax: `--env=ENV=VALUE`.
 *
 * @see https://github.com/sindresorhus/execa/blob/main/docs/escaping.md
 * @see https://github.com/sindresorhus/execa/blob/main/docs/shell.md
 *
 * @param command the command to run
 * @param args arguments to pass to the command
 * @param options Execa options to modify the behavior of the spawn
 * @returns An Execa object with the result
 */
export function launchSync(
  command: string,
  args?: ReadonlyArray<string>,
  options?: LaunchSyncOptions
): ReturnType<typeof execaSync> {
  const argsWithSpacing = (args || [])
    .map(arg => {
      return arg.replaceAll(' ', '\\ ');
    })
    .join(' ');
  const parsedCommand = parseCommandString(`${command} ${argsWithSpacing}`);

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

    // Use template string as array format quotes arguments even when using shell
    return execaSync(newOpts)`${parsedCommand}`;
  }

  if (options) {
    return execaSync(options)`${parsedCommand}`;
  } else {
    return execaSync`${parsedCommand}`;
  }
}
