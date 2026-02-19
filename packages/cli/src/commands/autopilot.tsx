import React from 'react';
import { render } from 'ink';
import colors from 'ansi-colors';
import { requireProjectContext } from '../lib/context.js';
import { exitWithError } from '../utils/exit.js';
import { AutopilotApp } from '../lib/autopilot/app.js';
import { ensureTraceDirs } from '../lib/autopilot/helpers.js';
import type { CommandDefinition } from '../types.js';

// Alternate screen buffer escape sequences
const ENTER_ALT_SCREEN = '\x1b[?1049h';
const LEAVE_ALT_SCREEN = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

const LANDING_MESSAGES = [
  'Mission complete! Returning to base.',
  'Touchdown! Back on solid ground.',
  'Autopilot disengaged. Welcome back, commander.',
  'Re-entry successful. All systems nominal.',
  'Landing sequence complete. Until next time, pilot.',
];

function printLandingMessage() {
  const msg =
    LANDING_MESSAGES[Math.floor(Math.random() * LANDING_MESSAGES.length)];
  console.log();
  console.log(colors.cyan('  \u2708  ') + colors.bold(msg));
  console.log();
}

const autopilotCommand = async (options: { refresh?: string } = {}) => {
  let project;
  try {
    project = await requireProjectContext();
  } catch (error) {
    exitWithError({
      error: error instanceof Error ? error.message : String(error),
      success: false,
    });
    return;
  }

  const refreshInterval = options.refresh
    ? Number.parseInt(options.refresh, 10)
    : 3;

  // Ensure spans/ and actions/ directories exist before any step runs
  ensureTraceDirs(project.id);

  // Enter alternate screen so quitting restores the original shell
  process.stdout.write(ENTER_ALT_SCREEN + HIDE_CURSOR);

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    process.stdout.write(SHOW_CURSOR + LEAVE_ALT_SCREEN);
  };

  // Ensure we restore on unexpected exit
  process.on('exit', restore);
  process.on('SIGINT', () => {
    restore();
    printLandingMessage();
    process.exit(0);
  });

  const { waitUntilExit } = render(
    <AutopilotApp project={project} refreshInterval={refreshInterval} />
  );

  await waitUntilExit();
  restore();
  printLandingMessage();
};

export default {
  name: 'autopilot',
  description:
    'Launch an interactive dashboard to monitor and visualize task progress',
  requireProject: true,
  action: autopilotCommand,
} satisfies CommandDefinition;
