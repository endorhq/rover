import colors from 'ansi-colors';

export enum TIP_TITLES {
  NEXT_STEPS = 'Next steps',
  TIPS = 'Tips',
}

export interface TipsConfig {
  title?: TIP_TITLES;
  emoji?: string;
  breakline?: boolean;
}

const defaultTipsConfig: TipsConfig = {
  title: TIP_TITLES.TIPS,
  emoji: '💡',
  breakline: true,
};

/**
 * Show tips on the CLI!
 */
export const showTips = (tips: string[], config: TipsConfig = {}) => {
  const buildConfig: TipsConfig = {
    ...defaultTipsConfig,
    ...config,
  };

  if (buildConfig.breakline) console.log('');

  console.log(colors.white(`${buildConfig.emoji} ${buildConfig.title}:`));

  for (const tip of tips) {
    console.log(colors.gray(`   ${tip}`));
  }
};

export interface RoverChatConfig {
  breaklineAfter?: boolean;
  breaklineBefore?: boolean;
}

const defaultRoverChatConfig: RoverChatConfig = {
  breaklineAfter: true,
  breaklineBefore: true,
};

/**
 * Show rover messages (like a robot) in the CLI for a more interactive
 * experience
 */
export const showRoverChat = (
  messages: string[],
  config: RoverChatConfig = {}
) => {
  const buildConfig: RoverChatConfig = {
    ...defaultRoverChatConfig,
    ...config,
  };

  if (buildConfig.breaklineBefore) console.log('');

  for (const message of messages) {
    // Use teal-400 (45, 212, 191) when true colors are supported
    const roverName = supportsTrueColor()
      ? rgb(45, 212, 191, 'Rover')
      : colors.cyan('Rover');
    console.log(`🤖 ${roverName}:`, message);
  }

  if (buildConfig.breaklineAfter) console.log('');
};

// Rover Banner

// Check for true color support
const supportsTrueColor = (): boolean => {
  return !!(
    process.env.COLORTERM === 'truecolor' ||
    process.env.TERM_PROGRAM === 'iTerm.app' ||
    process.env.TERM_PROGRAM === 'vscode' ||
    process.env.TERM === 'xterm-256color' ||
    process.env.TERM === 'tmux-256color' ||
    process.env.FORCE_COLOR === '3'
  );
};

// Create RGB color function
const rgb = (r: number, g: number, b: number, text: string): string => {
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
};

export const showRoverBanner = () => {
  const bannerText = [
    '▗▄▄▖  ▗▄▖ ▗▖  ▗▖▗▄▄▄▖▗▄▄▖ ',
    '▐▌ ▐▌▐▌ ▐▌▐▌  ▐▌▐▌   ▐▌ ▐▌',
    '▐▛▀▚▖▐▌ ▐▌▐▌  ▐▌▐▛▀▀▘▐▛▀▚▖',
    '▐▌ ▐▌▝▚▄▞▘ ▝▚▞▘ ▐▙▄▄▖▐▌ ▐▌',
  ];

  let banner;

  if (supportsTrueColor()) {
    // True color teal gradient from top to bottom (vertical)
    const colorSteps = [
      [94, 234, 212], // Teal 300 - top
      [45, 212, 191], // Teal 400
      [20, 184, 166], // Teal 500
      [13, 148, 136], // Teal 600 - bottom
    ];

    banner = bannerText
      .map((line, lineIndex) => {
        // Apply color based on line index (vertical gradient)
        const colorIndex = Math.min(lineIndex, colorSteps.length - 1);
        const [r, g, b] = colorSteps[colorIndex];

        // Apply the same color to all characters in the line
        return line
          .split('')
          .map(char => rgb(r, g, b, char))
          .join('');
      })
      .join('\n');
  } else {
    // Fallback to simple cyan
    banner = bannerText.map(line => colors.cyan(line)).join('\n');
  }

  console.log(banner);
};
