import { join } from 'node:path';
import { mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { getDataDir, launch } from 'rover-core';

export interface MemorySearchResult {
  file: string;
  content: string;
  score: number;
}

/**
 * MemoryStore — persistence and search for autopilot memory.
 *
 * Stores daily activity logs as markdown files under
 * `~/.rover/data/projects/{projectId}/autopilot/memory/daily/`.
 *
 * Uses QMD (local markdown search engine) for hybrid search.
 * Gracefully degrades when QMD is not installed.
 */
export class MemoryStore {
  private projectId: string;
  private basePath: string;
  private dailyPath: string;
  private collectionName: string;
  private qmdAvailable: boolean | null = null;

  /** Serializes all QMD process launches to avoid parallel CPU/memory spikes. */
  private qmdQueue: Promise<void> = Promise.resolve();

  constructor(projectId: string) {
    this.projectId = projectId;
    this.basePath = join(
      getDataDir(),
      'projects',
      projectId,
      'autopilot',
      'memory'
    );
    this.dailyPath = join(this.basePath, 'daily');
    this.collectionName = `rover-${projectId}`;
  }

  /**
   * Ensure the memory directory exists and register the QMD collection.
   * Safe to call multiple times.
   */
  async ensureSetup(): Promise<void> {
    mkdirSync(this.dailyPath, { recursive: true });

    if (!(await this.isQmdAvailable())) return;

    try {
      // Register the daily directory as a QMD collection
      await launch('qmd', [
        'collection',
        'add',
        this.collectionName,
        this.dailyPath,
      ]);
    } catch {
      // QMD collection may already exist — ignore errors
    }

    try {
      // Add context so QMD knows how to interpret the files
      await launch('qmd', [
        'context',
        'add',
        this.collectionName,
        'Rover autopilot daily activity logs. Each file is one day of trace summaries.',
      ]);
    } catch {
      // Ignore context add errors
    }
  }

  /**
   * Append an entry to today's daily log file.
   */
  appendDailyEntry(entry: string): void {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filePath = join(this.dailyPath, `${today}.md`);

    // Add a header if the file doesn't exist yet
    if (!existsSync(filePath)) {
      appendFileSync(filePath, `# Daily Activity Log — ${today}\n\n`, 'utf8');
    }

    appendFileSync(filePath, entry + '\n', 'utf8');
  }

  /**
   * Search memory using QMD BM25 keyword search.
   * Returns empty results if QMD is unavailable.
   * Serialized via qmdQueue to prevent parallel QMD processes.
   */
  async search(query: string, limit = 5): Promise<MemorySearchResult[]> {
    if (!(await this.isQmdAvailable())) return [];

    return this.enqueueQmd(async () => {
      const result = await launch('qmd', [
        'search',
        query,
        '--collection',
        this.collectionName,
        '--json',
        '--limit',
        String(limit),
      ]);

      const stdout = result.stdout?.toString().trim();
      if (!stdout) return [];

      const parsed = JSON.parse(stdout);

      // QMD returns an array of results with file, content, score fields
      if (Array.isArray(parsed)) {
        return parsed.map((r: any) => ({
          file: r.file ?? r.path ?? '',
          content: r.content ?? r.text ?? r.snippet ?? '',
          score: r.score ?? 0,
        }));
      }

      // Some QMD versions wrap results in a `results` key
      if (parsed.results && Array.isArray(parsed.results)) {
        return parsed.results.map((r: any) => ({
          file: r.file ?? r.path ?? '',
          content: r.content ?? r.text ?? r.snippet ?? '',
          score: r.score ?? 0,
        }));
      }

      return [];
    });
  }

  /**
   * Trigger QMD embedding for the collection.
   * Serialized via qmdQueue so it doesn't overlap with searches.
   * Only re-embeds changed files, so this is fast.
   */
  async triggerEmbed(): Promise<void> {
    if (!(await this.isQmdAvailable())) return;

    // Enqueue but don't await — callers don't need the result.
    // The queue ensures it won't overlap with concurrent searches.
    this.enqueueQmd(async () => {
      await launch('qmd', ['embed', '--collection', this.collectionName]);
    }).catch(() => {});
  }

  /**
   * Enqueue a QMD operation so only one runs at a time.
   * Concurrent callers wait in line instead of spawning parallel processes.
   */
  private enqueueQmd<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.qmdQueue;
    let resolve: (v: T) => void;
    let reject: (e: unknown) => void;
    const result = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    this.qmdQueue = prev
      .then(() => fn().then(resolve!, reject!))
      .catch(() => {});

    return result;
  }

  /**
   * Check if QMD is available on the system.
   * Caches the result after the first check.
   */
  private async isQmdAvailable(): Promise<boolean> {
    if (this.qmdAvailable !== null) return this.qmdAvailable;

    try {
      await launch('qmd', ['--version']);
      this.qmdAvailable = true;
    } catch {
      this.qmdAvailable = false;
    }

    return this.qmdAvailable;
  }
}
