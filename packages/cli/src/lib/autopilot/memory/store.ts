import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from 'rover-core';

export interface MemorySearchResult {
  file: string;
  content: string;
  score: number;
}

/**
 * Persistence and search for autopilot memory.
 *
 * Stores daily activity logs as markdown files under the provided base path.
 *
 * Uses QMD (local markdown search engine) for BM25 keyword search.
 * Gracefully degrades when QMD is not installed.
 */
export class MemoryStore {
  readonly collectionName: string;
  private readonly dailyPath: string;
  private qmdAvailable: boolean | null = null;

  /** Serializes all QMD process launches to avoid parallel CPU/memory spikes. */
  private qmdQueue: Promise<void> = Promise.resolve();

  constructor(basePath: string, collectionName: string) {
    this.dailyPath = join(basePath, 'daily');
    this.collectionName = collectionName;
  }

  /**
   * Create the memory directories and register the QMD collection.
   * Safe to call multiple times.
   */
  async ensureSetup(): Promise<void> {
    mkdirSync(this.dailyPath, { recursive: true });

    if (!(await this.isQmdAvailable())) return;

    try {
      await launch('qmd', [
        'collection',
        'add',
        this.dailyPath,
        '--name',
        this.collectionName,
      ]);
    } catch {
      // Collection may already exist
    }

    try {
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

  /** Append an entry to today's daily log file. */
  appendDailyEntry(entry: string): void {
    const today = new Date().toISOString().slice(0, 10);
    const filePath = join(this.dailyPath, `${today}.md`);

    if (!existsSync(filePath)) {
      appendFileSync(filePath, `# Daily Activity Log — ${today}\n\n`, 'utf8');
    }

    appendFileSync(filePath, `${entry}\n`, 'utf8');
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

      const parsed: unknown = JSON.parse(stdout);
      const items = extractResultArray(parsed);

      return items.map(normalizeSearchResult);
    });
  }

  /**
   * Trigger QMD update for the collection. Fire-and-forget via the serialized
   * queue so it doesn't overlap with concurrent searches.
   */
  async update(): Promise<void> {
    if (!(await this.isQmdAvailable())) return;

    this.enqueueQmd(async () => {
      await launch('qmd', ['update']);
    }).catch(() => {});
  }

  /**
   * Enqueue a QMD operation so only one runs at a time.
   */
  private enqueueQmd<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.qmdQueue;
    const result = new Promise<T>((resolve, reject) => {
      this.qmdQueue = prev
        .then(() => fn().then(resolve, reject))
        .catch(() => {});
    });

    return result;
  }

  /** Check if QMD is available on the system. Caches after first check. */
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

/** Extract the results array from QMD JSON output (handles both flat and wrapped formats). */
function extractResultArray(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];

  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'results' in parsed &&
    Array.isArray((parsed as Record<string, unknown>).results)
  ) {
    return (parsed as Record<string, unknown>).results as Record<
      string,
      unknown
    >[];
  }

  return [];
}

/** Normalize a single QMD search result into our typed interface. */
function normalizeSearchResult(r: Record<string, unknown>): MemorySearchResult {
  return {
    file: (r.file as string) ?? (r.path as string) ?? '',
    content:
      (r.content as string) ??
      (r.text as string) ??
      (r.snippet as string) ??
      '',
    score: (r.score as number) ?? 0,
  };
}
