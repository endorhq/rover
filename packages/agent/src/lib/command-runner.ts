/**
 * Command runner for executing shell commands as workflow steps.
 * Resolves {{...}} placeholders in command and args, captures output.
 */

import { launch } from 'rover-core';
import type { WorkflowCommandStep } from 'rover-schemas';
import { resolvePlaceholders as sharedResolvePlaceholders } from './placeholders.js';

const DEFAULT_COMMAND_TIMEOUT = 300; // 5 minutes in seconds
const MAX_OUTPUT_SIZE = 100_000; // 100KB cap per stdout/stderr to avoid blowing agent token limits

/**
 * Shell-escape a single argument by wrapping it in single quotes.
 * Any embedded single quotes are escaped as `'\''`.
 *
 * This prevents placeholder-resolved values from being interpreted as
 * shell metacharacters (e.g. `;`, `|`, `&&`, `$()`).
 */
export function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

export interface CommandStepResult {
  id: string;
  success: boolean;
  error?: string;
  duration: number;
  outputs: Map<string, string>;
}

/**
 * Truncate output to MAX_OUTPUT_SIZE, keeping the tail (most recent output)
 * since test failures typically appear at the end.
 */
export function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_SIZE) return output;
  return `[...truncated ${output.length - MAX_OUTPUT_SIZE} chars...]\n${output.slice(-MAX_OUTPUT_SIZE)}`;
}

/**
 * Resolve {{inputs.X}} and {{steps.Y.outputs.Z}} placeholders in a string.
 * Throws if any placeholders cannot be resolved so typos and missing outputs
 * are caught early rather than producing silent empty-string substitutions.
 *
 * Delegates to the shared resolvePlaceholders utility with failOnUnresolved=true.
 */
export function resolvePlaceholders(
  template: string,
  inputs: Map<string, string>,
  stepsOutput: Map<string, Map<string, string>>
): string {
  const { text } = sharedResolvePlaceholders(template, {
    inputs,
    stepsOutput,
    failOnUnresolved: true,
  });
  return text;
}

/**
 * Warn at runtime if the command field contains {{...}} placeholders.
 * Placeholders in args are shell-escaped, but those in the command string
 * are passed directly to `bash -c` and can execute arbitrary shell code.
 *
 * Each unique command string is warned about at most once per process to
 * avoid flooding logs in loops that re-execute the same command step.
 */
const warnedCommands = new Set<string>();
export function warnIfCommandHasPlaceholders(command: string): void {
  if (/\{\{.*?\}\}/.test(command) && !warnedCommands.has(command)) {
    warnedCommands.add(command);
    console.warn(
      '⚠ Security warning: command field contains {{...}} placeholders ' +
        'that will be interpreted by the shell without escaping. ' +
        'Move dynamic values to the "args" field for safe shell-escaping.'
    );
  }
}

/**
 * Execute a command step, capturing stdout, stderr, exit_code, and success.
 */
export async function runCommandStep(
  step: WorkflowCommandStep,
  inputs: Map<string, string>,
  stepsOutput: Map<string, Map<string, string>>,
  timeoutSeconds?: number
): Promise<CommandStepResult> {
  const start = performance.now();
  const outputs = new Map<string, string>();

  warnIfCommandHasPlaceholders(step.command);

  const resolvedCommand = resolvePlaceholders(
    step.command,
    inputs,
    stepsOutput
  );
  const resolvedArgs = (step.args ?? []).map(arg =>
    resolvePlaceholders(arg, inputs, stepsOutput)
  );

  // SECURITY NOTE: The `command` field is passed **unescaped** to `bash -c`
  // so that workflow authors can use pipes, redirections, and other shell
  // features.  Only `args` are individually shell-escaped.  This means
  // placeholders resolved into the `command` string (e.g.
  // `{{inputs.test_command}}`) are interpreted by the shell — workflow
  // authors must ensure those values are trusted.
  //
  // Each resolved arg is shell-escaped to prevent injection through
  // placeholder-resolved values (e.g. step outputs or user inputs
  // containing `;`, `|`, `$()`, etc.).
  const fullCommand =
    resolvedArgs.length > 0
      ? [resolvedCommand, ...resolvedArgs.map(shellEscape)].join(' ')
      : resolvedCommand;

  const timeout = (timeoutSeconds ?? DEFAULT_COMMAND_TIMEOUT) * 1000;

  // Use bash instead of sh (dash on Debian) to handle inaccessible PATH
  // entries gracefully. Source .profile so language-specific PATH additions
  // (Go, Python, Rust, etc.) are available in the spawned shell.
  const wrappedCommand =
    '[ -f "$HOME/.profile" ] && . "$HOME/.profile" 2>/dev/null; ' + fullCommand;

  try {
    const result = await launch('bash', ['-c', wrappedCommand], {
      reject: false,
      timeout,
    });

    const exitCode = result.exitCode ?? -1;
    const stdout = truncateOutput(result.stdout?.toString() ?? '');
    const stderr = truncateOutput(result.stderr?.toString() ?? '');

    outputs.set('exit_code', String(exitCode));
    outputs.set('stdout', stdout);
    outputs.set('stderr', stderr);
    outputs.set('success', String(exitCode === 0));

    const duration = (performance.now() - start) / 1000;

    return {
      id: step.id,
      success: exitCode === 0,
      error:
        exitCode !== 0
          ? stderr || `Command exited with code ${exitCode}`
          : undefined,
      duration,
      outputs,
    };
  } catch (err) {
    const duration = (performance.now() - start) / 1000;
    const errorMsg = err instanceof Error ? err.message : String(err);

    outputs.set('exit_code', '-1');
    outputs.set('stdout', '');
    outputs.set('stderr', errorMsg);
    outputs.set('success', 'false');

    return {
      id: step.id,
      success: false,
      error: errorMsg,
      duration,
      outputs,
    };
  }
}
