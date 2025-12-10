import colors from 'ansi-colors';
import logUpdate from 'log-update';
import { showTitle } from './title.js';
import type {
  ProcessItem,
  ProcessItemStatus,
  ProcessOptions,
} from './types.js';

/**
 * Manages a sequential process display with status indicators
 *
 * This class implements the "Process" pattern from CLI guidelines,
 * showing a list of steps that are completed sequentially with
 * status indicators, timestamps, and messages.
 *
 * Example output:
 * ```
 * Run the task in the background
 * ------------------------------
 * ● 12:30 | Created the rover/task-123jhksdna branch and worktree
 * ● 12:31 | Starting the rover-task-44-1 container
 * ◐ 12:32 | Waiting for container to be ready
 * ```
 *
 * Status indicators follow CLI color guidelines:
 * - Pending: default color
 * - In Progress: cyan
 * - Completed: green
 * - Failed: red
 *
 * @example
 * ```typescript
 * const process = new ProcessManager({ title: "Deploy application" });
 * process.start();
 *
 * process.addItem("Creating deployment");
 * await create();
 * process.completeLastItem();
 *
 * process.addItem("Uploading artifacts");
 * for (const [index, file] of files.entries()) {
 *   process.updateLastItem(`Uploading artifacts (${index + 1}/${files.length})`);
 *   await upload(file);
 * }
 * process.completeLastItem();
 *
 * process.finish();
 * ```
 */
export class ProcessManager {
  private items: ProcessItem[] = [];
  private options: Required<ProcessOptions>;
  private started = false;
  private spinnerInterval?: NodeJS.Timeout;
  private spinnerFrameIndex = 0;
  private readonly spinnerFrames = ['◐', '◓', '◑', '◒'];
  private readonly spinnerEnabled: boolean;

  constructor(options: ProcessOptions) {
    this.options = {
      showTimestamp: true,
      ...options,
    };

    this.spinnerEnabled = this.isInteractiveEnvironment();
  }

  /**
   * Start the process by displaying the title
   * This should be called before adding any items
   */
  start(): void {
    if (this.started) {
      return;
    }
    showTitle(this.options.title);
    this.started = true;
  }

  /**
   * Add a new item to the process log with "in_progress" status
   * The item will be rendered using log-update for live updates
   *
   * @param message - The message to display for this process step
   */
  addItem(message: string): void {
    if (!this.started) {
      this.start();
    }

    this.stopSpinner();
    this.spinnerFrameIndex = 0;

    this.items.push({
      message,
      status: 'in_progress',
      timestamp: new Date(),
    });

    this.render();
    this.ensureSpinner();
  }

  /**
   * Update the last item's message without changing its status
   * Useful for showing progress updates on an ongoing task
   *
   * @param message - The new message to display
   * @throws Error if there are no items to update
   *
   * @example
   * ```typescript
   * process.addItem("Downloading file");
   * process.updateLastItem("Downloading file (25%)");
   * process.updateLastItem("Downloading file (50%)");
   * process.updateLastItem("Downloading file (100%)");
   * process.completeLastItem();
   * ```
   */
  updateLastItem(message: string): void {
    const lastItem = this.getLastItem();
    lastItem.message = message;
    this.render();
  }

  /**
   * Mark the last item as completed
   * This persists the item to the terminal and prepares for the next item
   *
   * @throws Error if there are no items to complete
   */
  completeLastItem(): void {
    const lastItem = this.getLastItem();
    this.stopSpinner();
    lastItem.status = 'completed';
    logUpdate.persist(this.formatItem(lastItem));
    logUpdate.clear();
  }

  /**
   * Mark the last item as failed
   * This persists the item to the terminal with error styling
   *
   * @param errorMessage - Optional error message to append/replace
   * @throws Error if there are no items to mark as failed
   */
  failLastItem(errorMessage?: string): void {
    const lastItem = this.getLastItem();
    this.stopSpinner();
    lastItem.status = 'failed';
    if (errorMessage) {
      lastItem.message = errorMessage;
    }
    logUpdate.persist(this.formatItem(lastItem));
    logUpdate.clear();
  }

  /**
   * Convenience method: complete the last item and add a new one
   *
   * @param message - The message for the new item
   */
  nextItem(message: string): void {
    if (this.items.length > 0) {
      this.completeLastItem();
    }
    this.addItem(message);
  }

  /**
   * Finish the process and persist all output
   * This ensures the final state is visible in the terminal
   */
  finish(): void {
    this.stopSpinner();
    logUpdate.done();
  }

  /**
   * Get the last item in the process
   * @throws Error if there are no items
   */
  private getLastItem(): ProcessItem {
    if (this.items.length === 0) {
      throw new Error('No items in process to update');
    }
    return this.items[this.items.length - 1];
  }

  /**
   * Re-render the current in-progress item using log-update
   */
  private render(): void {
    const lastItem = this.items[this.items.length - 1];
    if (lastItem && lastItem.status === 'in_progress') {
      logUpdate(this.formatItem(lastItem));
    }
  }

  /**
   * Format a single process item with status icon, timestamp, and message
   *
   * @param item - The process item to format
   * @returns Formatted string ready for display
   */
  private formatItem(item: ProcessItem): string {
    const icon = this.getStatusIcon(item.status);
    const parts: string[] = [icon];

    if (this.options.showTimestamp) {
      const time = this.formatTime(item.timestamp);
      parts.push(time);
      parts.push(colors.gray('|'));
    }

    parts.push(item.message);

    return parts.join(' ');
  }

  /**
   * Get the colored status icon for a given status
   *
   * @param status - The process item status
   * @returns Colored icon character
   */
  private getStatusIcon(status: ProcessItemStatus): string {
    switch (status) {
      case 'pending':
        return '○'; // Default color (no color applied)
      case 'in_progress':
        return colors.cyan(
          this.spinnerFrames[
            this.spinnerEnabled
              ? this.spinnerFrameIndex % this.spinnerFrames.length
              : 0
          ]
        ); // Cyan for ongoing work
      case 'completed':
        return colors.green('●'); // Green for success
      case 'failed':
        return colors.red('●'); // Red for errors
    }
  }

  /**
   * Format a timestamp as HH:MM
   *
   * @param date - The date to format
   * @returns Time string in HH:MM format
   */
  private formatTime(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return colors.gray(`${hours}:${minutes}`);
  }

  /**
   * Ensure the spinner interval is running for the active in-progress item
   */
  private ensureSpinner(): void {
    if (!this.spinnerEnabled || this.spinnerInterval) {
      return;
    }

    this.spinnerInterval = setInterval(() => {
      const lastItem = this.items[this.items.length - 1];
      if (!lastItem || lastItem.status !== 'in_progress') {
        this.stopSpinner();
        return;
      }

      this.spinnerFrameIndex =
        (this.spinnerFrameIndex + 1) % this.spinnerFrames.length;

      this.render();
    }, 120);
  }

  /**
   * Stop the spinner interval when no item is in progress
   */
  private stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = undefined;
    }

    this.spinnerFrameIndex = 0;
  }

  /**
   * Determine if the current environment supports interactive spinners
   */
  private isInteractiveEnvironment(): boolean {
    if (!process.stdout.isTTY) {
      return false;
    }

    const { CI, GITHUB_ACTIONS } = process.env;
    if (GITHUB_ACTIONS) {
      return false;
    }

    if (CI && CI !== 'false' && CI !== '0') {
      return false;
    }

    return true;
  }
}
