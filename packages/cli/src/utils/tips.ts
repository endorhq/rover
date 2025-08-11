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
const showTips = (tips: string[], config: TipsConfig = {}) => {
    const buildConfig = {
        ...defaultTipsConfig,
        ...config
    };

    if (buildConfig.breakline) console.log('');

    console.log(colors.white(`${buildConfig.emoji} ${buildConfig.title}:`));

    for (const tip of tips) {
        console.log(colors.gray(`   ${tip}`));
    }
};

export default showTips;