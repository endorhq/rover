import colors from 'ansi-colors';

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

export const roverBanner = () => {
    const bannerText = [
        '▗▄▄▖  ▗▄▖ ▗▖  ▗▖▗▄▄▄▖▗▄▄▖ ',
        '▐▌ ▐▌▐▌ ▐▌▐▌  ▐▌▐▌   ▐▌ ▐▌',
        '▐▛▀▚▖▐▌ ▐▌▐▌  ▐▌▐▛▀▀▘▐▛▀▚▖',
        '▐▌ ▐▌▝▚▄▞▘ ▝▚▞▘ ▐▙▄▄▖▐▌ ▐▌'
    ];

    if (supportsTrueColor()) {
        // True color green gradient from bright green to dark green
        const colorSteps = [
            [144, 238, 144], // Light green
            [102, 205, 102], // Medium green
            [60, 179, 113],  // Sea green
            [34, 139, 34],   // Forest green
            [0, 100, 0]      // Dark green
        ];

        return bannerText.map(line => {
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
        return bannerText.map(line => colors.white(line)).join('\n');
    }
};

