/**
 * JSONL structured logger for recording workflow execution events.
 * Appends validated log entries as JSON lines to a file.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  JsonlLogEntrySchema,
  type JsonlLogEntry,
  type LogLevel,
  type LogEvent,
} from 'rover-schemas';

export class JsonlLogger {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;

    // Ensure parent directory exists
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Get the log file path
   */
  get path(): string {
    return this.filePath;
  }

  /**
   * Append a validated log entry to the JSONL file
   */
  log(entry: JsonlLogEntry): void {
    try {
      const validated = JsonlLogEntrySchema.parse(entry);
      const line = JSON.stringify(validated) + '\n';
      appendFileSync(this.filePath, line, 'utf8');
    } catch (error) {
      console.error(
        `Warning: Failed to write log entry: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Log an info-level event
   */
  info(
    event: LogEvent,
    message: string,
    fields?: Partial<JsonlLogEntry>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      event,
      message,
      ...fields,
    });
  }

  /**
   * Log a warn-level event
   */
  warn(
    event: LogEvent,
    message: string,
    fields?: Partial<JsonlLogEntry>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      event,
      message,
      ...fields,
    });
  }

  /**
   * Log an error-level event
   */
  error(
    event: LogEvent,
    message: string,
    fields?: Partial<JsonlLogEntry>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: 'error',
      event,
      message,
      ...fields,
    });
  }

  /**
   * Log a debug-level event
   */
  debug(
    event: LogEvent,
    message: string,
    fields?: Partial<JsonlLogEntry>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      level: 'debug',
      event,
      message,
      ...fields,
    });
  }

  /**
   * Read all log entries from a JSONL file.
   * Skips lines that fail to parse.
   */
  static readAll(filePath: string): JsonlLogEntry[] {
    if (!existsSync(filePath)) {
      return [];
    }

    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    const entries: JsonlLogEntry[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const validated = JsonlLogEntrySchema.parse(parsed);
        entries.push(validated);
      } catch {
        // Skip invalid lines
      }
    }

    return entries;
  }
}
