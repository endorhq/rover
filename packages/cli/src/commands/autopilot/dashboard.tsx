import { render } from 'ink';
import colors from 'ansi-colors';
import { getDefaultProject } from '../../lib/context.js';
import { ProjectConfigManager } from 'rover-core';
import { AUTOPILOT_MODE_VALUES } from 'rover-schemas';
import { exitWithError } from '../../utils/exit.js';
import { LaunchableApp } from '../../lib/autopilot/views/index.js';
import { ensureTraceDirs } from '../../lib/autopilot/helpers.js';
import type { CommandDefinition } from '../../types.js';

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

interface AutopilotOptions {
  mode?: string;
  allowEvents?: string;
  refresh?: string;
  botName?: string;
  bot?: string;
  maintainers?: string[];
}

const autopilotCommand = async (options: AutopilotOptions = {}) => {
  const project = getDefaultProject();
  if (!project) {
    exitWithError({
      error: 'The autopilot command requires a project context.',
      success: false,
    });
    return;
  }

  // Load project configuration for autopilot defaults
  const config = ProjectConfigManager.load(project.path);
  const autopilotConfig = config.autopilot;

  // Resolve options: CLI flags > rover.json config > defaults
  const resolvedMode = options.mode ?? autopilotConfig?.mode ?? 'self-driving';

  if (
    !AUTOPILOT_MODE_VALUES.includes(
      resolvedMode as (typeof AUTOPILOT_MODE_VALUES)[number]
    )
  ) {
    exitWithError({
      error: `Invalid --mode value "${resolvedMode}". Expected "self-driving" or "assistant".`,
      success: false,
    });
    return;
  }

  const resolvedAllowEvents =
    options.allowEvents ?? autopilotConfig?.allowEvents ?? 'maintainers';
  const resolvedRefreshInterval = options.refresh
    ? parseInt(options.refresh, 10)
    : (autopilotConfig?.refreshInterval ?? 30);
  const resolvedBotName =
    options.botName ?? options.bot ?? autopilotConfig?.botName;
  const resolvedMaintainers =
    options.maintainers ?? autopilotConfig?.maintainers;

  // When filtering by maintainers, ensure they are configured
  if (resolvedAllowEvents === 'maintainers' && !resolvedMaintainers?.length) {
    exitWithError({
      error:
        'The --allow-events "maintainers" filter requires at least one maintainer. ' +
        'Set maintainers via --maintainers or in rover.json under autopilot.maintainers.',
      success: false,
    });
    return;
  }

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
    <LaunchableApp
      project={project}
      mode={resolvedMode}
      allowEvents={resolvedAllowEvents}
      refreshInterval={resolvedRefreshInterval}
      botName={resolvedBotName}
      maintainers={resolvedMaintainers}
    />
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
