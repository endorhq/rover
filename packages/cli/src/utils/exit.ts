import colors from 'ansi-colors';
import { CLIJsonOutput, CLIJsonOutputWithErrors } from '../types.js';
import { showTips, TipsConfig } from './display.js';
import Telemetry from 'rover-telemetry';

type ExitWithErrorOpts = {
  exitCode?: number;
  tips?: string[];
  tipsConfig?: TipsConfig;
  telemetry?: Telemetry;
};

type ExitWithWarnOpts = ExitWithErrorOpts;

type ExitWithSuccessOpts = {
  tips?: string[];
  tipsConfig?: TipsConfig;
  telemetry?: Telemetry;
};

/**
 * Exit the current process and print an error message or the full
 * JSON object. This method expects the JSON output to include a
 * .error property with the error message.
 *
 * It can also show a set of tips to show after the error message.
 * It will show only on non-json outputs.
 */
export const exitWithError = (
  jsonOutput: CLIJsonOutput,
  json: boolean | undefined,
  options: ExitWithErrorOpts = {}
) => {
  exitWithErrors(
    {
      success: jsonOutput.success,
      errors: jsonOutput.error ? [jsonOutput.error] : [],
    },
    json,
    options
  );
};

/**
 * Exit the current process and print a list of error messages or the
 * full JSON object. This method expects the JSON output to include a
 * .error property with the error message.
 *
 * It can also show a set of tips to show after the error messages.
 * It will show only on non-json outputs.
 */
export const exitWithErrors = async (
  jsonOutput: CLIJsonOutputWithErrors,
  json: boolean | undefined,
  options: ExitWithErrorOpts = {}
) => {
  const { tips, tipsConfig, exitCode, telemetry } = options;

  // Flush telemetry before exiting
  if (telemetry) {
    await telemetry.shutdown();
  }

  if (json === true) {
    console.log(JSON.stringify(jsonOutput, null, 2));
  } else {
    for (const error of jsonOutput.errors) {
      console.log(colors.red(`\n✗ ${error}`));
    }
    if (tips != null) showTips(tips, tipsConfig);
  }

  process.exit(exitCode || 1);
};

/**
 * Exits the program with a warning message. By default, it just returns a 0
 * exitCode, but you can change it.
 */
export const exitWithWarn = async (
  warnMessage: string,
  jsonOutput: CLIJsonOutput,
  json: boolean | undefined,
  options: ExitWithWarnOpts = {}
) => {
  const { tips, tipsConfig, exitCode, telemetry } = options;

  // Flush telemetry before exiting
  if (telemetry) {
    await telemetry.shutdown();
  }

  if (json === true) {
    console.log(JSON.stringify(jsonOutput, null, 2));
  } else {
    console.log(colors.yellow(`\n⚠ ${warnMessage}`));

    if (tips != null) showTips(tips, tipsConfig);
  }

  process.exit(exitCode || 0);
};

/**
 * Exits the program showing a success message and an optional
 * set of tips.
 */
export const exitWithSuccess = async (
  successMessage: string,
  jsonOutput: CLIJsonOutput,
  json: boolean | undefined,
  options: ExitWithSuccessOpts = {}
) => {
  const { tips, tipsConfig, telemetry } = options;

  // Flush telemetry before exiting
  if (telemetry) {
    await telemetry.shutdown();
  }

  if (json === true) {
    console.log(JSON.stringify(jsonOutput, null, 2));
  } else {
    console.log(colors.green(`\n✓ ${successMessage}`));

    if (tips != null) showTips(tips, tipsConfig);
  }

  process.exit();
};
