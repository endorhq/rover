import colors, { type StyleFunction } from 'ansi-colors';

const TERMINAL_STATUSES = ['COMPLETED', 'MERGED', 'PUSHED'];
const ACTIVE_STATUSES = ['IN_PROGRESS', 'ITERATING'];

/**
 * Whether a task status represents a terminal (finished successfully) state.
 * FAILED is intentionally excluded so users can still debug the container.
 */
export const isTerminalStatus = (status: string): boolean =>
  TERMINAL_STATUSES.includes(status.toUpperCase());

/**
 * Whether a task status represents an active (currently running) state.
 */
export const isActiveStatus = (status: string): boolean =>
  ACTIVE_STATUSES.includes(status.toUpperCase());

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
    case 'MERGED':
      return 'Merged';
    case 'PUSHED':
      return 'Pushed';
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
    case 'MERGED':
      return colors.green;
    case 'PUSHED':
      return colors.green;
    default:
      return colors.gray;
  }
};
