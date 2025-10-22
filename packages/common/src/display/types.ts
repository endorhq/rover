/**
 * Display types and interfaces for consistent CLI output
 */

/**
 * Color scheme following CLI guidelines:
 * - Default color (no color): regular text
 * - Cyan: titles
 * - Purple: main information (single element per section)
 * - Gray: properties and less relevant information
 * - Green: successful responses
 * - Yellow: ongoing work and warning information
 * - Red: failed operations and errors
 */
export type DisplayColor =
  | 'cyan'
  | 'purple'
  | 'gray'
  | 'green'
  | 'yellow'
  | 'red'
  | 'default';

/**
 * Options for displaying tips
 */
export interface TipsOptions {
  /**
   * Whether to add a line break before the tip
   * @default true
   */
  addLineBreak?: boolean;
}

/**
 * Status of a process item
 */
export type ProcessItemStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed';

/**
 * A single item in the process log
 */
export interface ProcessItem {
  /** Display message for the item */
  message: string;
  /** Current status of the item */
  status: ProcessItemStatus;
  /** Timestamp when the item was created */
  timestamp: Date;
}

/**
 * Options for creating a process manager
 */
export interface ProcessOptions {
  /** Title for the process section */
  title: string;
  /** Whether to show timestamps in output (default: true) */
  showTimestamp?: boolean;
}

/**
 * Options for displaying lists
 */
export interface ListOptions {
  /** Optional title to display above the list */
  title?: string;
  /** Whether to add a line break before the list (default: false) */
  addLineBreak?: boolean;
}

/**
 * Options for displaying properties
 */
export interface PropertiesOptions {
  /** Whether to add a line break before the properties (default: false) */
  addLineBreak?: boolean;
}
