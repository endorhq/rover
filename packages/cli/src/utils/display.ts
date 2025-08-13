import colors from 'ansi-colors';

export enum TIP_TITLES {
    NEXT_STEPS = 'Next steps',
    TIPS = 'Tips',
}

export interface TipsConfig {
    title?: TIP_TITLES,
    emoji?: string,
    breakline?: boolean
}

const defaultTipsConfig: TipsConfig = {
    title: TIP_TITLES.TIPS,
    emoji: '💡',
    breakline: true
}

/**
 * Show tips on the CLI!
 */
export const showTips = (tips: string[], config: TipsConfig = {}) => {
    const buildConfig: TipsConfig = {
        ...defaultTipsConfig,
        ...config
    };

    if (buildConfig.breakline) console.log('');

    console.log(colors.white(`${buildConfig.emoji} ${buildConfig.title}:`));

    for (const tip of tips) {
        console.log(colors.gray(`   ${tip}`));
    }
};

export interface RoverChatConfig {
    breaklineAfter?: boolean,
    breaklineBefore?: boolean
}

const defaultRoverChatConfig: RoverChatConfig = {
    breaklineAfter: true,
    breaklineBefore: true,
}

/**
 * Show rover messages (like a robot) in the CLI for a more interactive
 * experience
 */
export const showRoverChat = (messages: string[], config: RoverChatConfig = {}) => {
    const buildConfig: RoverChatConfig = {
        ...defaultRoverChatConfig,
        ...config
    };

    if (buildConfig.breaklineBefore) console.log('');

    for (const message of messages) {
        console.log(`🤖 ${colors.green("Rover")}:`, message);
    }

    if (buildConfig.breaklineAfter) console.log('');
}

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
        '▐▌ ▐▌▝▚▄▞▘ ▝▚▞▘ ▐▙▄▄▖▐▌ ▐▌'
    ];

    let banner;

    if (supportsTrueColor()) {
        // True color green gradient from bright green to dark green
        const colorSteps = [
            [144, 238, 144], // Light green
            [102, 205, 102], // Medium green
            [60, 179, 113],  // Sea green
            [34, 139, 34],   // Forest green
            [0, 100, 0]      // Dark green
        ];

        banner = bannerText.map(line => {
            const chars = line.split('');
            const step = Math.ceil(chars.length / colorSteps.length);

            return chars.map((char, i) => {
                const colorIndex = Math.min(Math.floor(i / step), colorSteps.length - 1);
                const [r, g, b] = colorSteps[colorIndex];
                return rgb(r, g, b, char);
            }).join('');
        }).join('\n');
    } else {
        // Fallback to simple green
        banner = bannerText.map(line => colors.white(line)).join('\n');
    }

    console.log(banner);
};

