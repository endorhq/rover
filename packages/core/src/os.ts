import {
  execa,
  execaSync,
  parseCommandString,
  type Options,
  type SyncOptions,
  type Result,
  type SyncResult,
} from 'execa';
import colors from 'ansi-colors';
import { VERBOSE } from './verbose.js';

// Re-export types from execa
export type { Options, Result, SyncOptions, SyncResult };

// Expand some types to add our custom options
export type LaunchOptions = Options & {
  mightLogSensitiveInformation?: boolean;
  /**
   * Whether to run the child process in a new process group (detached mode).
   * Defaults to true to prevent child processes from being terminated when
   * signals are sent to the parent's process group.
   *
   * Set to false for interactive processes (like shells) that need proper
   * TTY signal handling and job control.
   */
  detached?: boolean;
};

export type LaunchSyncOptions = SyncOptions & {
  mightLogSensitiveInformation?: boolean;
};

/**
 * Logging function for stdout and stderr streams
 *
 * @param stream the name of the strem it will log (stdout, stderr, etc)
 * @returns a generator function that logs the chunk data
 */
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

// Generate loggers
const logStdout = log('stdout');
const logStderr = log('stderr');

/**
 * Expand the stdio option into individual stdin, stdout, stderr options.
 * This prevents conflicts with execa when setting both stdio and individual streams.
 *
 * @param options The launch options that may contain a stdio property
 * @returns New options with stdio expanded to stdin/stdout/stderr
 */
const expandStdioOption = <T extends Options | SyncOptions>(
  options?: T
): T | undefined => {
  if (!options || !options.stdio) {
    return options;
  }

  const { stdio, ...rest } = options;
  return {
    ...rest,
    stdin: stdio,
    stdout: stdio,
    stderr: stdio,
  } as T;
};

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
  // Expand stdio option to prevent conflicts with execa
  const expandedOptions = expandStdioOption(options);

  const commandWithMaybeSpacing = command.replaceAll(' ', '\\ ');
  const argsWithMaybeSpacing = (args || [])
    .map(arg => {
      return arg.replaceAll(' ', '\\ ');
    })
    .join(' ');
  const parsedCommand = parseCommandString(
    `${commandWithMaybeSpacing} ${argsWithMaybeSpacing}`
  );

  if (VERBOSE) {
    const now = new Date();
    console.error(
      colors.gray(now.toISOString()) +
        colors.cyan(' Command ') +
        colors.gray(`${command} ${args?.join(' ')}`)
    );

    // Check first if we need to add logging
    // Run in a new process group to prevent child processes from being
    // terminated when signals are sent to the parent's process group.
    // See: https://github.com/endorhq/rover/issues/374
    // Default to detached: true unless explicitly set to false (e.g., for interactive shells)
    const shouldDetach = options?.detached !== false;
    let newOpts: Options = {
      detached: shouldDetach,
      ...expandedOptions,
    } as Options;

    if (shouldAddLogging('stdout', expandedOptions)) {
      const stdout = expandedOptions?.stdout
        ? [
            logStdout({
              mightLogSensitiveInformation:
                expandedOptions?.mightLogSensitiveInformation,
            }),
            expandedOptions.stdout,
          ].flat()
        : [
            logStdout({
              mightLogSensitiveInformation:
                expandedOptions?.mightLogSensitiveInformation,
            }),
          ];

      newOpts = {
        ...newOpts,
        stdout,
      } as Options;
    }

    if (shouldAddLogging('stderr', expandedOptions)) {
      const stderr = expandedOptions?.stderr
        ? [
            logStderr({
              mightLogSensitiveInformation:
                expandedOptions?.mightLogSensitiveInformation,
            }),
            expandedOptions.stderr,
          ].flat()
        : [
            logStderr({
              mightLogSensitiveInformation:
                expandedOptions?.mightLogSensitiveInformation,
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

  // Run in a new process group to prevent child processes from being
  // terminated when signals are sent to the parent's process group.
  // See: https://github.com/endorhq/rover/issues/374
  // Default to detached: true unless explicitly set to false (e.g., for interactive shells)
  const shouldDetach = options?.detached !== false;
  if (expandedOptions) {
    return execa({
      detached: shouldDetach,
      ...expandedOptions,
    })`${parsedCommand}`;
  } else {
    return execa({ detached: shouldDetach })`${parsedCommand}`;
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
  // Expand stdio option to prevent conflicts with execa
  const expandedOptions = expandStdioOption(options);

  const commandWithMaybeSpacing = command.replaceAll(' ', '\\ ');
  const argsWithMaybeSpacing = (args || [])
    .map(arg => {
      return arg.replaceAll(' ', '\\ ');
    })
    .join(' ');
  const parsedCommand = parseCommandString(
    `${commandWithMaybeSpacing} ${argsWithMaybeSpacing}`
  );

  if (VERBOSE) {
    const now = new Date();
    console.error(
      colors.gray(now.toISOString()) +
        colors.cyan(' Command ') +
        colors.gray(`${command} ${args?.join(' ')}`)
    );

    // Check first if we need to add logging
    let newOpts: SyncOptions = {
      ...expandedOptions,
    } as SyncOptions;

    if (shouldAddLogging('stdout', expandedOptions)) {
      const stdout = expandedOptions?.stdout
        ? [
            logStdout({
              mightLogSensitiveInformation:
                expandedOptions?.mightLogSensitiveInformation,
            }),
            expandedOptions.stdout,
          ].flat()
        : [
            logStdout({
              mightLogSensitiveInformation:
                expandedOptions?.mightLogSensitiveInformation,
            }),
          ];

      newOpts = {
        ...newOpts,
        stdout,
      } as SyncOptions;
    }

    if (shouldAddLogging('stderr', expandedOptions)) {
      const stderr = expandedOptions?.stderr
        ? [
            logStderr({
              mightLogSensitiveInformation:
                expandedOptions?.mightLogSensitiveInformation,
            }),
            expandedOptions.stderr,
          ].flat()
        : [
            logStderr({
              mightLogSensitiveInformation:
                expandedOptions?.mightLogSensitiveInformation,
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

  if (expandedOptions) {
    return execaSync(expandedOptions)`${parsedCommand}`;
  } else {
    return execaSync`${parsedCommand}`;
  }
}
