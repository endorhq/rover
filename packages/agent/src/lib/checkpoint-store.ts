import colors from 'ansi-colors';
import {
  readFileSync,
  existsSync,
  writeFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';

export interface CheckpointCompletedStep {
  id: string;
  outputs: Record<string, string>;
}

export interface CheckpointLoopProgress {
  iteration: number;
  nextSubStepIndex: number;
  subStepOutputs: Record<string, Record<string, string>>;
  skippedSubSteps: string[];
}

export interface CheckpointData {
  completedSteps: CheckpointCompletedStep[];
  loopProgress?: Record<string, CheckpointLoopProgress>;
  failedStepId?: string;
  error?: string;
  isRetryable?: boolean;
  provider?: string;
}

function normalizeLoopProgress(
  value: unknown
): Record<string, CheckpointLoopProgress> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const normalized: Record<string, CheckpointLoopProgress> = {};

  for (const [loopId, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;

    const iteration =
      typeof entry.iteration === 'number' &&
      Number.isInteger(entry.iteration) &&
      entry.iteration > 0
        ? entry.iteration
        : undefined;
    const nextSubStepIndex =
      typeof entry.nextSubStepIndex === 'number' &&
      Number.isInteger(entry.nextSubStepIndex) &&
      entry.nextSubStepIndex >= 0
        ? entry.nextSubStepIndex
        : undefined;

    if (iteration == null || nextSubStepIndex == null) continue;

    const rawSubStepOutputs = entry.subStepOutputs;
    const subStepOutputs: Record<string, Record<string, string>> = {};
    if (
      rawSubStepOutputs &&
      typeof rawSubStepOutputs === 'object' &&
      !Array.isArray(rawSubStepOutputs)
    ) {
      for (const [stepId, outputs] of Object.entries(rawSubStepOutputs)) {
        if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
          continue;
        }
        subStepOutputs[stepId] = Object.fromEntries(
          Object.entries(outputs).map(([key, outputValue]) => [
            key,
            String(outputValue),
          ])
        );
      }
    }

    const skippedSubSteps = Array.isArray(entry.skippedSubSteps)
      ? entry.skippedSubSteps.filter(
          (stepId: unknown): stepId is string => typeof stepId === 'string'
        )
      : [];

    normalized[loopId] = {
      iteration,
      nextSubStepIndex,
      subStepOutputs,
      skippedSubSteps,
    };
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function loadCheckpoint(path: string): CheckpointData | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.completedSteps)) return null;

    const completedSteps: CheckpointCompletedStep[] = data.completedSteps
      .filter(
        (step: unknown): step is { id: string; outputs?: unknown } =>
          step != null &&
          typeof step === 'object' &&
          typeof (step as any).id === 'string'
      )
      .map((step: { id: string; outputs?: Record<string, string> }) => ({
        id: step.id,
        outputs: Object.fromEntries(
          Object.entries(step.outputs ?? {}).map(([key, value]) => [
            key,
            String(value),
          ])
        ),
      }));

    return {
      completedSteps,
      loopProgress: normalizeLoopProgress(data.loopProgress),
      failedStepId:
        typeof data.failedStepId === 'string' ? data.failedStepId : undefined,
      error: typeof data.error === 'string' ? data.error : undefined,
      isRetryable:
        typeof data.isRetryable === 'boolean' ? data.isRetryable : undefined,
      provider: typeof data.provider === 'string' ? data.provider : undefined,
    };
  } catch (err) {
    console.warn(
      colors.yellow(
        `Warning: Failed to load checkpoint: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    return null;
  }
}

export function saveCheckpoint(
  outputDir: string | undefined,
  data: CheckpointData
): boolean {
  if (!outputDir) return false;
  const checkpointPath = join(outputDir, 'checkpoint.json');
  const tmpPath = checkpointPath + '.tmp';
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    renameSync(tmpPath, checkpointPath);
    console.log(colors.gray(`  Checkpoint saved to ${checkpointPath}`));
    return true;
  } catch (err) {
    // Clean up stale .tmp file on failure
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // Ignore cleanup errors
    }
    console.error(
      colors.yellow(
        `Warning: Failed to save checkpoint: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    return false;
  }
}

export function clearCheckpointFile(outputDir: string | undefined): void {
  if (!outputDir) return;
  try {
    const checkpointPath = join(outputDir, 'checkpoint.json');
    rmSync(checkpointPath, { force: true });
  } catch (err) {
    console.error(
      colors.yellow(
        `Warning: Failed to clear checkpoint: ${err instanceof Error ? err.message : String(err)}`
      )
    );
  }
}

export interface CheckpointStore {
  getData(): CheckpointData;
  getCompletedStep(stepId: string): CheckpointCompletedStep | undefined;
  getLoopProgress(loopId: string): CheckpointLoopProgress | undefined;
  setLoopProgress(loopId: string, progress: CheckpointLoopProgress): void;
  clearLoopProgress(loopId: string): void;
  setCompletedSteps(completedSteps: CheckpointCompletedStep[]): void;
  saveFailureSnapshot(data: {
    completedSteps: CheckpointCompletedStep[];
    failedStepId: string;
    error?: string;
    isRetryable?: boolean;
    provider?: string;
  }): void;
}

export function createCheckpointStore(
  outputDir: string | undefined,
  initialData: CheckpointData | null = null
): CheckpointStore {
  const data: CheckpointData = {
    completedSteps: (initialData?.completedSteps ?? []).map(s => ({
      id: s.id,
      outputs: { ...s.outputs },
    })),
    ...(initialData?.loopProgress
      ? {
          loopProgress: structuredClone(initialData.loopProgress),
        }
      : {}),
    failedStepId: initialData?.failedStepId,
    error: initialData?.error,
    isRetryable: initialData?.isRetryable,
    provider: initialData?.provider,
  };

  const persist = (): boolean => {
    return saveCheckpoint(outputDir, data);
  };

  return {
    getData: () => ({
      ...data,
      completedSteps: data.completedSteps.map(s => ({
        id: s.id,
        outputs: { ...s.outputs },
      })),
      ...(data.loopProgress
        ? { loopProgress: structuredClone(data.loopProgress) }
        : {}),
    }),
    getCompletedStep(stepId: string) {
      const step = data.completedSteps.find(step => step.id === stepId);
      if (!step) return undefined;
      return { id: step.id, outputs: { ...step.outputs } };
    },
    getLoopProgress(loopId: string) {
      const progress = data.loopProgress?.[loopId];
      if (!progress) return undefined;
      return structuredClone(progress);
    },
    setLoopProgress(loopId: string, progress: CheckpointLoopProgress) {
      // Mirror load-time validation: reject clearly invalid values
      if (!Number.isInteger(progress.iteration) || progress.iteration <= 0) {
        console.warn(
          colors.yellow(
            `Warning: Ignoring invalid loop progress for "${loopId}": iteration=${progress.iteration}`
          )
        );
        return;
      }
      if (
        !Number.isInteger(progress.nextSubStepIndex) ||
        progress.nextSubStepIndex < 0
      ) {
        console.warn(
          colors.yellow(
            `Warning: Ignoring invalid loop progress for "${loopId}": nextSubStepIndex=${progress.nextSubStepIndex}`
          )
        );
        return;
      }

      if (!data.loopProgress) {
        data.loopProgress = {};
      }
      const deepCopiedOutputs: Record<string, Record<string, string>> = {};
      for (const [stepId, outputs] of Object.entries(progress.subStepOutputs)) {
        deepCopiedOutputs[stepId] = { ...outputs };
      }
      data.loopProgress[loopId] = {
        iteration: progress.iteration,
        nextSubStepIndex: progress.nextSubStepIndex,
        subStepOutputs: deepCopiedOutputs,
        skippedSubSteps: [...progress.skippedSubSteps],
      };
      if (!persist()) {
        console.warn(
          colors.yellow(
            `Warning: Failed to persist loop progress for "${loopId}". In-memory state may diverge from disk.`
          )
        );
      }
    },
    clearLoopProgress(loopId: string) {
      if (!data.loopProgress?.[loopId]) return;
      delete data.loopProgress[loopId];
      if (Object.keys(data.loopProgress).length === 0) {
        delete data.loopProgress;
      }
      if (!persist()) {
        console.warn(
          colors.yellow(
            `Warning: Failed to persist loop progress removal for "${loopId}". In-memory state may diverge from disk.`
          )
        );
      }
    },
    setCompletedSteps(completedSteps: CheckpointCompletedStep[]) {
      data.completedSteps = completedSteps.map(step => ({
        id: step.id,
        outputs: { ...step.outputs },
      }));
      if (!persist()) {
        console.warn(
          colors.yellow(
            'Warning: Failed to persist completed steps. In-memory state may diverge from disk.'
          )
        );
      }
    },
    saveFailureSnapshot({
      completedSteps,
      failedStepId,
      error,
      isRetryable,
      provider,
    }) {
      // Batch both completedSteps and failure fields into a single persist() call
      data.completedSteps = completedSteps.map(step => ({
        id: step.id,
        outputs: { ...step.outputs },
      }));
      data.failedStepId = failedStepId;
      data.error = error;
      data.isRetryable = isRetryable;
      data.provider = provider;
      const saved = persist();
      if (!saved) {
        console.warn(
          colors.yellow(
            '⚠ WARNING: Checkpoint could not be saved before pause. Resume may replay completed steps.'
          )
        );
      }
    },
  };
}
