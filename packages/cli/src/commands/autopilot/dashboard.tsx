
import { render } from 'ink';
import colors from 'ansi-colors';
import { requireProjectContext } from '../../lib/context.js';
import { ProjectConfigManager, type ProjectManager } from 'rover-core';
import { exitWithError } from '../../utils/exit.js';
import { LaunchableApp } from '../../lib/autopilot/launch.js';
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

const autopilotCommand = async (
  options: {
    refresh?: string;
    from?: string;
    bot?: string;
    botName?: string;
    maintainers?: string[];
    allowEvents?: string;
    mode?: string;
  } = {}
) => {
  let project: ProjectManager | undefined;
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
    : 30;

  let fromDate: Date | undefined;
  if (options.from) {
    fromDate = new Date(options.from);
    if (Number.isNaN(fromDate.getTime())) {
      exitWithError({
        error: `Invalid --from value "${options.from}". Expected a date (e.g. 2025-01-15) or datetime (e.g. 2025-01-15T09:30:00).`,
        success: false,
      });
      return;
    }
  }

  // Ensure spans/ and actions/ directories exist before any step runs
  ensureTraceDirs(project.id);

  // Resolve autopilot config: CLI flags > rover.json > undefined
  const projectConfig = ProjectConfigManager.load(project.path);
  const autopilotConfig = projectConfig.autopilot;
  const resolvedBotName =
    options.botName ?? options.bot ?? autopilotConfig?.botName;
  const resolvedMaintainers =
    options.maintainers ?? autopilotConfig?.maintainers;

  // Resolve allow-events: CLI flag > rover.json > default "maintainers"
  const resolvedAllowEvents =
    options.allowEvents ?? autopilotConfig?.allowEvents ?? 'maintainers';

  if (
    resolvedAllowEvents === 'maintainers' &&
    (!resolvedMaintainers || resolvedMaintainers.length === 0)
  ) {
    exitWithError(
      {
        error:
          'The default --allow-events mode is "maintainers", but no maintainers are configured.',
        success: false,
      },
      {
        tips: [
          'Add maintainers via --maintainers flag: rover autopilot --maintainers alice bob',
          'Or set them in rover.json: { "autopilot": { "maintainers": ["alice", "bob"] } }',
          'Or use --allow-events all to process events from all actors (not recommended for public repos)',
        ],
      }
    );
    return;
  }

  if (resolvedAllowEvents === 'all') {
    console.warn(
      colors.yellow(
        '⚠ --allow-events=all: processing events from ALL actors. This may increase token usage and exposes the coordinator to prompt injection from untrusted users.'
      )
    );
  }

  // Resolve mode: CLI flag > rover.json > default "self-driving"
  const resolvedMode = options.mode ?? autopilotConfig?.mode ?? 'self-driving';

  if (resolvedMode !== 'self-driving' && resolvedMode !== 'assistant') {
    exitWithError({
      error: `Invalid --mode value "${resolvedMode}". Expected "self-driving" or "assistant".`,
      success: false,
    });
    return;
  }

  if (resolvedMode === 'assistant') {
    console.log(
      colors.cyan(
        '🛡 Assistant mode: push and notify steps will dry-run. You will see commands to run manually.'
      )
    );
  }

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
      refreshInterval={refreshInterval}
      fromDate={fromDate}
      botName={resolvedBotName}
      maintainers={resolvedMaintainers}
      allowEvents={resolvedAllowEvents}
      mode={resolvedMode}
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
