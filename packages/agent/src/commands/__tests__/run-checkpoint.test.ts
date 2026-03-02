import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import {
  saveCheckpoint,
  loadCheckpoint,
  isTransientError,
  isRetryableError,
  type CheckpointData,
} from '../run.js';
import { createCheckpointStore } from '../../lib/checkpoint-store.js';

describe('checkpoint save/load', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rover-checkpoint-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should save and load a checkpoint with completed steps', () => {
    const data: CheckpointData = {
      completedSteps: [
        { id: 'step1', outputs: { result: 'hello' } },
        { id: 'step2', outputs: { summary: 'world' } },
      ],
      failedStepId: 'step3',
      error: 'Rate limit reached',
      isRetryable: true,
    };

    saveCheckpoint(tempDir, data);

    const checkpointPath = join(tempDir, 'checkpoint.json');
    expect(existsSync(checkpointPath)).toBe(true);

    const loaded = loadCheckpoint(checkpointPath);
    expect(loaded).not.toBeNull();
    expect(loaded!.completedSteps).toHaveLength(2);
    expect(loaded!.completedSteps[0].id).toBe('step1');
    expect(loaded!.completedSteps[0].outputs.result).toBe('hello');
    expect(loaded!.completedSteps[1].id).toBe('step2');
    expect(loaded!.failedStepId).toBe('step3');
    expect(loaded!.error).toBe('Rate limit reached');
    expect(loaded!.isRetryable).toBe(true);
  });

  it('should save checkpoint with empty completed steps', () => {
    const data: CheckpointData = {
      completedSteps: [],
      failedStepId: 'step1',
      error: 'Credit limit exhausted',
    };

    saveCheckpoint(tempDir, data);

    const loaded = loadCheckpoint(join(tempDir, 'checkpoint.json'));
    expect(loaded).not.toBeNull();
    expect(loaded!.completedSteps).toHaveLength(0);
    expect(loaded!.failedStepId).toBe('step1');
  });

  it('should return null for non-existent checkpoint file', () => {
    const loaded = loadCheckpoint('/nonexistent/path/checkpoint.json');
    expect(loaded).toBeNull();
  });

  it('should return null for invalid JSON', () => {
    const invalidPath = join(tempDir, 'bad-checkpoint.json');
    writeFileSync(invalidPath, 'not valid json', 'utf8');
    const loaded = loadCheckpoint(invalidPath);
    expect(loaded).toBeNull();
  });

  it('should return null for JSON without completedSteps array', () => {
    const badPath = join(tempDir, 'no-steps.json');
    writeFileSync(badPath, JSON.stringify({ error: 'something' }), 'utf8');
    const loaded = loadCheckpoint(badPath);
    expect(loaded).toBeNull();
  });

  it('should not throw when outputDir is undefined', () => {
    expect(() =>
      saveCheckpoint(undefined, {
        completedSteps: [],
        failedStepId: 'step1',
      })
    ).not.toThrow();
  });

  it('should return false when outputDir is undefined', () => {
    const result = saveCheckpoint(undefined, {
      completedSteps: [],
      failedStepId: 'step1',
    });
    expect(result).toBe(false);
  });

  it('should return true on successful save', () => {
    const result = saveCheckpoint(tempDir, {
      completedSteps: [{ id: 'step1', outputs: { a: '1' } }],
    });
    expect(result).toBe(true);
  });

  it('should not leave a .tmp file after successful save', () => {
    saveCheckpoint(tempDir, {
      completedSteps: [{ id: 'step1', outputs: { a: '1' } }],
    });
    const tmpPath = join(tempDir, 'checkpoint.json.tmp');
    expect(existsSync(tmpPath)).toBe(false);
    expect(existsSync(join(tempDir, 'checkpoint.json'))).toBe(true);
  });

  it('should return false when outputDir does not exist', () => {
    const result = saveCheckpoint('/nonexistent/dir/that/does/not/exist', {
      completedSteps: [],
    });
    expect(result).toBe(false);
  });

  it('should overwrite existing checkpoint on re-save', () => {
    const data1: CheckpointData = {
      completedSteps: [{ id: 'step1', outputs: { a: '1' } }],
      failedStepId: 'step2',
    };
    saveCheckpoint(tempDir, data1);

    const data2: CheckpointData = {
      completedSteps: [
        { id: 'step1', outputs: { a: '1' } },
        { id: 'step2', outputs: { b: '2' } },
      ],
      failedStepId: 'step3',
    };
    saveCheckpoint(tempDir, data2);

    const loaded = loadCheckpoint(join(tempDir, 'checkpoint.json'));
    expect(loaded!.completedSteps).toHaveLength(2);
    expect(loaded!.failedStepId).toBe('step3');
  });

  it('should save and load provider field', () => {
    const data: CheckpointData = {
      completedSteps: [{ id: 'step1', outputs: { result: 'done' } }],
      failedStepId: 'step2',
      error: 'Credit limit',
      isRetryable: true,
      provider: 'claude',
    };

    saveCheckpoint(tempDir, data);

    const loaded = loadCheckpoint(join(tempDir, 'checkpoint.json'));
    expect(loaded).not.toBeNull();
    expect(loaded!.provider).toBe('claude');
  });

  it('should save and load loop progress', () => {
    const data: CheckpointData = {
      completedSteps: [{ id: 'step1', outputs: { result: 'done' } }],
      loopProgress: {
        review_loop: {
          iteration: 2,
          nextSubStepIndex: 1,
          subStepOutputs: {
            run_tests: { exit_code: '1', stderr: 'failed' },
          },
          skippedSubSteps: ['fix_agent'],
        },
      },
      failedStepId: 'review_loop',
    };

    saveCheckpoint(tempDir, data);

    const loaded = loadCheckpoint(join(tempDir, 'checkpoint.json'));
    expect(loaded).not.toBeNull();
    expect(loaded!.loopProgress).toEqual(data.loopProgress);
  });

  it('should handle checkpoint without provider (backward compat)', () => {
    const data: CheckpointData = {
      completedSteps: [],
      failedStepId: 'step1',
    };

    saveCheckpoint(tempDir, data);

    const loaded = loadCheckpoint(join(tempDir, 'checkpoint.json'));
    expect(loaded).not.toBeNull();
    expect(loaded!.provider).toBeUndefined();
  });

  it('should ignore malformed loop progress but still load checkpoint', () => {
    const badPath = join(tempDir, 'bad-loop-progress.json');
    writeFileSync(
      badPath,
      JSON.stringify({
        completedSteps: [{ id: 'step1', outputs: { result: 'ok' } }],
        loopProgress: {
          loop1: {
            iteration: 'two',
            nextSubStepIndex: -1,
            subStepOutputs: 'bad',
          },
        },
      }),
      'utf8'
    );

    const loaded = loadCheckpoint(badPath);
    expect(loaded).not.toBeNull();
    expect(loaded!.completedSteps).toHaveLength(1);
    expect(loaded!.loopProgress).toBeUndefined();
  });

  it('should log a warning when checkpoint JSON is corrupted', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const corruptPath = join(tempDir, 'corrupt.json');
    writeFileSync(corruptPath, '{"completedSteps": [trun', 'utf8');

    const loaded = loadCheckpoint(corruptPath);
    expect(loaded).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load checkpoint')
    );
    warnSpy.mockRestore();
  });

  it('should use renameSync (atomic) — no .tmp file left even on success', () => {
    saveCheckpoint(tempDir, {
      completedSteps: [{ id: 's1', outputs: { x: '1' } }],
    });

    // Verify the final file exists and no .tmp
    expect(existsSync(join(tempDir, 'checkpoint.json'))).toBe(true);
    expect(existsSync(join(tempDir, 'checkpoint.json.tmp'))).toBe(false);

    // Verify content is valid
    const raw = readFileSync(join(tempDir, 'checkpoint.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.completedSteps[0].id).toBe('s1');
  });

  it('should coerce non-string output values to strings', () => {
    const badPath = join(tempDir, 'coerce.json');
    writeFileSync(
      badPath,
      JSON.stringify({
        completedSteps: [
          { id: 'step1', outputs: { num: 42, bool: false, nil: null } },
        ],
      }),
      'utf8'
    );

    const loaded = loadCheckpoint(badPath);
    expect(loaded).not.toBeNull();
    expect(loaded!.completedSteps[0].outputs.num).toBe('42');
    expect(loaded!.completedSteps[0].outputs.bool).toBe('false');
    expect(loaded!.completedSteps[0].outputs.nil).toBe('null');
  });
});

describe('createCheckpointStore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rover-store-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('deep copies subStepOutputs so caller mutations do not affect store', () => {
    const store = createCheckpointStore(tempDir);
    const progress = {
      iteration: 1,
      nextSubStepIndex: 2,
      subStepOutputs: { step1: { exit_code: '0' } },
      skippedSubSteps: [],
    };

    store.setLoopProgress('loop1', progress);

    // Mutate the original object after storing
    progress.subStepOutputs.step1.exit_code = '999';

    // Store should have the original value, not the mutated one
    const stored = store.getLoopProgress('loop1');
    expect(stored!.subStepOutputs.step1.exit_code).toBe('0');
  });

  it('persists failure snapshot and warns on save failure', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Create store with invalid outputDir so persist fails
    const store = createCheckpointStore('/nonexistent/dir/fails');

    store.saveFailureSnapshot({
      completedSteps: [{ id: 's1', outputs: { a: '1' } }],
      failedStepId: 's2',
      error: 'credit limit',
      isRetryable: true,
      provider: 'claude',
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Checkpoint could not be saved')
    );
    warnSpy.mockRestore();
  });

  it('retains in-memory failure data even when persist fails', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createCheckpointStore('/nonexistent/dir/fails');

    store.saveFailureSnapshot({
      completedSteps: [{ id: 's1', outputs: { a: '1' } }],
      failedStepId: 's2',
      error: 'credit limit',
      isRetryable: true,
      provider: 'claude',
    });

    // Even though persist failed, in-memory data should be correct
    const data = store.getData();
    expect(data.failedStepId).toBe('s2');
    expect(data.error).toBe('credit limit');
    expect(data.isRetryable).toBe(true);
    expect(data.provider).toBe('claude');
    expect(data.completedSteps).toHaveLength(1);
    expect(data.completedSteps[0].id).toBe('s1');

    warnSpy.mockRestore();
  });

  it('warns when loop progress persistence fails', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createCheckpointStore('/nonexistent/dir/fails');

    store.setLoopProgress('loop1', {
      iteration: 2,
      nextSubStepIndex: 1,
      subStepOutputs: { step_a: { exit_code: '0' } },
      skippedSubSteps: [],
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist loop progress')
    );

    // In-memory state should still be set
    const progress = store.getLoopProgress('loop1');
    expect(progress).not.toBeUndefined();
    expect(progress!.iteration).toBe(2);
    expect(progress!.nextSubStepIndex).toBe(1);

    warnSpy.mockRestore();
  });

  it('warns when completed steps persistence fails', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createCheckpointStore('/nonexistent/dir/fails');

    store.setCompletedSteps([
      { id: 's1', outputs: { result: 'done' } },
      { id: 's2', outputs: { result: 'also done' } },
    ]);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist completed steps')
    );

    // In-memory state should still be set
    const data = store.getData();
    expect(data.completedSteps).toHaveLength(2);

    warnSpy.mockRestore();
  });
  it('clears stale failure metadata when initializing from a prior checkpoint', () => {
    const initialData: CheckpointData = {
      completedSteps: [{ id: 'step1', outputs: { result: 'hello' } }],
      failedStepId: 'step2',
      error: 'Credit limit reached',
      isRetryable: true,
      provider: 'claude',
    };

    const store = createCheckpointStore(tempDir, initialData);
    const data = store.getData();

    // Completed steps should be preserved
    expect(data.completedSteps).toHaveLength(1);
    expect(data.completedSteps[0].id).toBe('step1');

    // Stale failure metadata should be cleared so intermediate persists
    // (from setCompletedSteps/setLoopProgress) don't write misleading data.
    expect(data.failedStepId).toBeUndefined();
    expect(data.error).toBeUndefined();
    expect(data.isRetryable).toBeUndefined();
    expect(data.provider).toBeUndefined();
  });

  it('addCompletedStep appends a new step and persists', () => {
    const store = createCheckpointStore(tempDir);

    store.addCompletedStep('step1', { result: 'hello' });

    const data = store.getData();
    expect(data.completedSteps).toHaveLength(1);
    expect(data.completedSteps[0]).toEqual({
      id: 'step1',
      outputs: { result: 'hello' },
    });

    // Verify persistence
    const loaded = loadCheckpoint(join(tempDir, 'checkpoint.json'));
    expect(loaded!.completedSteps).toHaveLength(1);
    expect(loaded!.completedSteps[0].id).toBe('step1');
  });

  it('addCompletedStep replaces existing step with same id (upsert)', () => {
    const store = createCheckpointStore(tempDir);

    store.addCompletedStep('step1', { result: 'v1' });
    store.addCompletedStep('step2', { result: 'v1' });
    store.addCompletedStep('step1', { result: 'v2' });

    const data = store.getData();
    expect(data.completedSteps).toHaveLength(2);
    // step1 should be updated in place (not appended)
    expect(data.completedSteps[0]).toEqual({
      id: 'step1',
      outputs: { result: 'v2' },
    });
    expect(data.completedSteps[1]).toEqual({
      id: 'step2',
      outputs: { result: 'v1' },
    });
  });

  it('addCompletedStep deep copies outputs to prevent aliasing', () => {
    const store = createCheckpointStore(tempDir);
    const outputs = { result: 'original' };

    store.addCompletedStep('step1', outputs);

    // Mutate the original object
    outputs.result = 'mutated';

    // Store should have the original value
    const data = store.getData();
    expect(data.completedSteps[0].outputs.result).toBe('original');
  });

  it('addCompletedStep warns when persist fails', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createCheckpointStore('/nonexistent/dir/fails');

    store.addCompletedStep('step1', { result: 'done' });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist completed steps')
    );

    // In-memory state should still be updated
    const data = store.getData();
    expect(data.completedSteps).toHaveLength(1);
    expect(data.completedSteps[0].id).toBe('step1');

    warnSpy.mockRestore();
  });

  it('getCompletedStep returns a copy that does not affect internal state', () => {
    const store = createCheckpointStore(tempDir);
    store.addCompletedStep('step1', { result: 'original' });

    const retrieved = store.getCompletedStep('step1');
    expect(retrieved).toBeDefined();
    retrieved!.outputs.result = 'mutated';

    // Internal state should be unchanged
    expect(store.getCompletedStep('step1')!.outputs.result).toBe('original');
  });

  it('getCompletedStep returns undefined for unknown step', () => {
    const store = createCheckpointStore(tempDir);
    expect(store.getCompletedStep('nonexistent')).toBeUndefined();
  });

  it('preserves loop progress when initializing from a prior checkpoint', () => {
    const initialData: CheckpointData = {
      completedSteps: [],
      loopProgress: {
        loop1: {
          iteration: 2,
          nextSubStepIndex: 1,
          subStepOutputs: { step1: { exit_code: '0' } },
          skippedSubSteps: [],
        },
      },
      failedStepId: 'agent_step',
      error: 'Rate limit',
      isRetryable: true,
    };

    const store = createCheckpointStore(tempDir, initialData);
    const data = store.getData();

    // Loop progress should be preserved for resume
    expect(data.loopProgress).toBeDefined();
    expect(data.loopProgress!['loop1'].iteration).toBe(2);

    // But failure metadata should be cleared
    expect(data.failedStepId).toBeUndefined();
    expect(data.error).toBeUndefined();
  });
});

describe('isTransientError', () => {
  it('should detect ECONNREFUSED as transient', () => {
    expect(isTransientError('connect ECONNREFUSED 127.0.0.1:443')).toBe(true);
  });

  it('should detect ETIMEDOUT as transient', () => {
    expect(isTransientError('connect ETIMEDOUT 1.2.3.4:443')).toBe(true);
  });

  it('should detect ENETUNREACH as transient', () => {
    expect(isTransientError('connect ENETUNREACH')).toBe(true);
  });

  it('should detect "network error" as transient', () => {
    expect(isTransientError('A network error occurred')).toBe(true);
  });

  it('should detect "connection refused" as transient', () => {
    expect(isTransientError('connection refused by server')).toBe(true);
  });

  it('should detect "connection reset" as transient', () => {
    expect(isTransientError('connection reset by peer')).toBe(true);
  });

  it('should detect "connection failed" as transient', () => {
    expect(isTransientError('connection failed to api.anthropic.com')).toBe(
      true
    );
  });

  it('should detect "too many requests" as transient', () => {
    expect(isTransientError('Error 429: too many requests')).toBe(true);
  });

  it('should detect bare 429 status as transient', () => {
    expect(isTransientError('HTTP 429')).toBe(true);
  });

  it('should NOT detect credit limit as transient', () => {
    expect(isTransientError("You've hit your limit")).toBe(false);
  });

  it('should NOT detect usage limit as transient', () => {
    expect(isTransientError('usage limit reached')).toBe(false);
  });

  it('should NOT detect plan limit as transient', () => {
    expect(isTransientError('plan limit exceeded')).toBe(false);
  });

  it('should NOT detect auth error as transient', () => {
    expect(isTransientError('invalid api key')).toBe(false);
  });

  it('should NOT detect empty string as transient', () => {
    expect(isTransientError('')).toBe(false);
  });

  it('should NOT detect credit balance as transient', () => {
    expect(isTransientError('insufficient credit balance')).toBe(false);
  });

  it('should detect "network_error" with underscore as transient', () => {
    expect(isTransientError('got a network_error from API')).toBe(true);
  });

  it('should detect "connection-refused" with hyphen as transient', () => {
    expect(isTransientError('connection-refused by host')).toBe(true);
  });

  it('should NOT detect "networkerror" without separator as transient', () => {
    expect(isTransientError('MyNetworkerrorHandler')).toBe(false);
  });

  it('should NOT detect "connectionfailed" without separator as transient', () => {
    expect(isTransientError('connectionfailed')).toBe(false);
  });

  it('should detect "too many requests" with spaces as transient', () => {
    expect(isTransientError('too many requests')).toBe(true);
  });

  it('should detect "too-many-requests" with hyphens as transient', () => {
    expect(isTransientError('too-many-requests')).toBe(true);
  });

  it('should NOT detect "toomany" without separator as transient', () => {
    expect(isTransientError('toomanyitems')).toBe(false);
  });

  it('should NOT match 429 embedded in a larger number', () => {
    expect(isTransientError('Error in file at line 4291')).toBe(false);
    expect(isTransientError('Reference ID: 14290')).toBe(false);
  });
});

describe('isRetryableError', () => {
  it('should detect rate_limit as retryable', () => {
    expect(isRetryableError('rate_limit exceeded')).toBe(true);
  });

  it('should detect rate limit with space as retryable', () => {
    expect(isRetryableError('rate limit reached')).toBe(true);
  });

  it('should detect credit limit as retryable', () => {
    expect(isRetryableError('credit limit reached')).toBe(true);
  });

  it('should detect credit exhaustion as retryable', () => {
    expect(isRetryableError('credit exhausted')).toBe(true);
  });

  it('should detect billing limit as retryable', () => {
    expect(isRetryableError('billing limit exceeded')).toBe(true);
  });

  it('should detect billing error as retryable', () => {
    expect(isRetryableError('billing error on your account')).toBe(true);
  });

  it('should detect quota exceeded as retryable', () => {
    expect(isRetryableError('quota exceeded for this month')).toBe(true);
  });

  it('should detect "hit your limit" as retryable', () => {
    expect(isRetryableError("You've hit your limit")).toBe(true);
  });

  it('should detect "usage limit" as retryable', () => {
    expect(isRetryableError('usage limit reached')).toBe(true);
  });

  it('should detect "plan limit" as retryable', () => {
    expect(isRetryableError('plan limit exceeded')).toBe(true);
  });

  it('should detect ECONNREFUSED as retryable', () => {
    expect(isRetryableError('connect ECONNREFUSED 127.0.0.1:443')).toBe(true);
  });

  it('should detect ETIMEDOUT as retryable', () => {
    expect(isRetryableError('connect ETIMEDOUT 10.0.0.1:443')).toBe(true);
  });

  it('should detect "too many requests" as retryable', () => {
    expect(isRetryableError('too many requests')).toBe(true);
  });

  it('should detect bare 429 as retryable', () => {
    expect(isRetryableError('HTTP 429')).toBe(true);
  });

  it('should NOT match 429 embedded in a larger number', () => {
    expect(isRetryableError('Error in file at line 4291')).toBe(false);
    expect(isRetryableError('Reference ID: 14290')).toBe(false);
  });

  it('should detect connection timeout as retryable', () => {
    expect(isRetryableError('connection timeout to api.anthropic.com')).toBe(
      true
    );
  });

  it('should respect error_retryable flag', () => {
    expect(isRetryableError('some unknown error', 'true')).toBe(true);
  });

  it('should NOT detect generic timeout as retryable', () => {
    expect(isRetryableError('step execution timeout after 300s')).toBe(false);
  });

  it('should NOT detect auth errors as retryable', () => {
    expect(isRetryableError('invalid api key')).toBe(false);
  });

  it('should NOT detect empty string as retryable', () => {
    expect(isRetryableError('')).toBe(false);
  });
});
