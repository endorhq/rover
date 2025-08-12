import colors, { type StyleFunction } from 'ansi-colors';

/**
 * Format task status for user-friendly display
 */
export const formatTaskStatus = (status: string): string => {
    switch (status.toUpperCase()) {
        case 'NEW':
            return 'New';
        case 'IN_PROGRESS':
            return 'In Progress';
        case 'COMPLETED':
            return 'Completed';
        case 'RUNNING':
            return 'Running';
        case 'FAILED':
            return 'Failed';
        case 'ITERATING':
            return 'Iterating';
        default:
            return status;
    }
};

export const statusColor = (status: string): StyleFunction => {
    switch (status.toUpperCase()) {
        case 'NEW':
            return colors.cyan;
        case 'IN_PROGRESS':
            return colors.yellow;
        case 'COMPLETED':
            return colors.green;
        case 'RUNNING':
            return colors.cyan;
        case 'ITERATING':
            return colors.magenta;
        case 'FAILED':
            return colors.red;
        default:
            return colors.gray;
    }
}