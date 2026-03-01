/**
 * Unified step dispatcher for workflow execution.
 * Routes steps to the appropriate executor based on step type:
 *   - agent → Runner
 *   - command → CommandRunner
 *   - loop → iterative sub-step execution
 */

import colors from 'ansi-colors';
import {
  type WorkflowManager,
  type IterationStatusManager,
  type JsonlLogger,
} from 'rover-core';
import {
  isAgentStep,
  isCommandStep,
  isLoopStep,
  type WorkflowStep,
  type WorkflowLoopStep,
} from 'rover-schemas';
import { Runner, type RunnerStepResult } from './runner.js';
import { runCommandStep, type CommandStepResult } from './command-runner.js';
import { evaluateCondition } from './condition.js';
import type { ACPRunner, ACPRunnerStepResult } from './acp-runner.js';
import type {
  CheckpointLoopProgress,
  CheckpointStore,
} from './checkpoint-store.js';

export interface StepExecutorConfig {
  workflow: WorkflowManager;
  inputs: Map<string, string>;
  stepsOutput: Map<string, Map<string, string>>;
  defaultTool?: string;
  defaultModel?: string;
  statusManager?: IterationStatusManager;
  totalSteps: number;
  currentStepIndex: number;
  logger?: JsonlLogger;
  output?: string;
  acpRunner?: ACPRunner;
  checkpointStore?: CheckpointStore;
}

export type StepResult =
  | RunnerStepResult
  | CommandStepResult
  | ACPRunnerStepResult;

const DEFAULT_MAX_ITERATIONS = 3;
const MAX_TRANSIENT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 10_000;

export class PauseWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PauseWorkflowError';
  }
}

export function isTransientError(errorMsg: string): boolean {
  return /ECONNREFUSED|ETIMEDOUT|ENETUNREACH|network[_\s-]error|connection[_\s-](failed|refused|reset)|too[_\s-]many[_\s-]requests|\b429\b/i.test(
    errorMsg
  );
}

/**
 * Check whether a step failure is retryable (e.g. credit/rate limits).
 * This is a superset of isTransientError — all transient errors are retryable,
 * plus credit/billing/quota limits.
 *
 * @param errorMsg - The error message from the step result (NOT general stdout/stderr)
 * @param errorRetryableFlag - Explicit `error_retryable` output from the agent, if set
 */
export function isRetryableError(
  errorMsg: string,
  errorRetryableFlag?: string
): boolean {
  if (errorRetryableFlag === 'true') return true;
  if (isTransientError(errorMsg)) return true;
  // Additional retryable patterns beyond transient errors:
  // credit/billing/quota limits that may resolve after a waiting period.
  // NOTE: Only match network/connection timeouts (ETIMEDOUT, connection.*timeout),
  // NOT generic "timeout" which would match step execution timeouts and cause
  // infinite pause-resume loops.
  return /rate[_\s-]limit|credit[_\s-](limit|exhaust)|billing[_\s-](limit|error)|quota[_\s-](exhaust|exceeded|limit)|hit your limit|usage limit|plan limit|connection[_\s-]timeout/i.test(
    errorMsg
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface StepTreeNode {
  id: string;
  steps?: StepTreeNode[];
}

export function collectNestedStepIds(step: StepTreeNode): string[] {
  return [step.id, ...(step.steps?.flatMap(collectNestedStepIds) ?? [])];
}

function snapshotLoopSubStepOutputs(
  loopStep: WorkflowLoopStep,
  stepsOutput: Map<string, Map<string, string>>
): Record<string, Record<string, string>> {
  const subStepOutputs: Record<string, Record<string, string>> = {};

  for (const stepId of loopStep.steps.flatMap((step: WorkflowStep) =>
    collectNestedStepIds(step)
  )) {
    const outputs = stepsOutput.get(stepId);
    if (!outputs || outputs.size === 0) continue;
    subStepOutputs[stepId] = Object.fromEntries(outputs);
  }

  return subStepOutputs;
}

function persistLoopProgress(
  loopStep: WorkflowLoopStep,
  config: StepExecutorConfig,
  iteration: number,
  nextSubStepIndex: number,
  skippedSubSteps: Set<string>
): void {
  config.checkpointStore?.setLoopProgress(loopStep.id, {
    iteration,
    nextSubStepIndex,
    subStepOutputs: snapshotLoopSubStepOutputs(loopStep, config.stepsOutput),
    skippedSubSteps: Array.from(skippedSubSteps),
  });
}

function restoreLoopProgress(
  loopStep: WorkflowLoopStep,
  config: StepExecutorConfig,
  progress: CheckpointLoopProgress
): boolean {
  const knownStepIds = new Set(
    loopStep.steps.flatMap((step: WorkflowStep) => collectNestedStepIds(step))
  );

  for (const [stepId, outputs] of Object.entries(progress.subStepOutputs)) {
    if (!knownStepIds.has(stepId)) continue;
    config.stepsOutput.set(stepId, new Map(Object.entries(outputs)));
  }

  for (const stepId of progress.skippedSubSteps) {
    if (!knownStepIds.has(stepId)) continue;
    config.stepsOutput.set(stepId, new Map());
  }

  return (
    progress.iteration > 0 &&
    progress.nextSubStepIndex >= 0 &&
    progress.nextSubStepIndex <= loopStep.steps.length
  );
}

/**
 * Check whether a step should be skipped based on its `if` condition.
 */
export function shouldSkipStep(
  step: WorkflowStep,
  stepsOutput: Map<string, Map<string, string>>
): boolean {
  if (!step.if) return false;
  return !evaluateCondition(step.if, stepsOutput);
}

/**
 * Execute a single workflow step, dispatching by type.
 *
 * Callers are responsible for checking `shouldSkipStep()` before invoking
 * this function.  Top-level steps are checked in `run.ts`; loop sub-steps
 * are checked in `executeLoopStep()`.
 */
export async function executeStep(
  step: WorkflowStep,
  config: StepExecutorConfig
): Promise<StepResult> {
  if (isAgentStep(step)) {
    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
      let result: StepResult;

      if (config.acpRunner) {
        // Reuse the warm ACP connection for agent sub-steps inside loops
        await config.acpRunner.createSession();

        // Sync current stepsOutput into the acpRunner so prompt placeholders resolve
        for (const [stepId, outputs] of config.stepsOutput.entries()) {
          config.acpRunner.stepsOutput.set(stepId, outputs);
        }

        try {
          result = await config.acpRunner.runStep(step.id);
        } finally {
          config.acpRunner.closeSession();
        }
      } else {
        const runner = new Runner(
          config.workflow,
          step.id,
          config.inputs,
          config.stepsOutput,
          config.defaultTool,
          config.defaultModel,
          config.statusManager,
          config.totalSteps,
          config.currentStepIndex,
          config.logger
        );
        result = await runner.run(config.output);
      }

      if (result.success) {
        return result;
      }

      const errorMsg = result.error || '';
      if (isTransientError(errorMsg) && attempt < MAX_TRANSIENT_RETRIES) {
        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(
          colors.yellow(
            `\n⚠ Transient error detected. Retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/${MAX_TRANSIENT_RETRIES})...`
          )
        );
        await sleep(delayMs);
        continue;
      }

      const retryable = isRetryableError(
        errorMsg,
        result.outputs?.get('error_retryable')
      );
      const provider =
        step.tool ||
        config.defaultTool ||
        config.workflow.defaults?.tool ||
        'claude';

      // Use checkpoint store's existing completed steps (only top-level steps
      // that have been fully completed), not the raw stepsOutput which may
      // include partial sub-step outputs from in-progress loops.
      const completedSteps =
        config.checkpointStore?.getData().completedSteps ?? [];

      config.checkpointStore?.saveFailureSnapshot({
        completedSteps,
        failedStepId: step.id,
        error: result.error,
        isRetryable: retryable,
        provider,
      });

      if (retryable) {
        config.statusManager?.pause(
          step.name,
          result.error || 'Usage limit reached',
          provider
        );
        throw new PauseWorkflowError(
          `Workflow paused due to retryable error: ${result.error}`
        );
      }

      return result;
    }

    throw new Error('Unexpected: retry loop exited without returning');
  }

  if (isCommandStep(step)) {
    const timeout = config.workflow.getStepTimeout(step.id);
    return runCommandStep(step, config.inputs, config.stepsOutput, timeout);
  }

  if (isLoopStep(step)) {
    return executeLoopStep(step, config);
  }

  throw new Error(`Unsupported step type: ${(step as any).type}`);
}

/**
 * Execute a loop step: iterate sub-steps until condition is met or max iterations reached.
 * The until condition is checked after each sub-step completes (once outputs are stored).
 */
async function executeLoopStep(
  loopStep: WorkflowLoopStep,
  config: StepExecutorConfig
): Promise<StepResult> {
  const start = performance.now();
  const workflowLoopLimit = config.workflow.config?.loopLimit;
  const stepMax = loopStep.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const maxIterations =
    workflowLoopLimit != null ? Math.min(stepMax, workflowLoopLimit) : stepMax;
  let conditionMet = false;
  let lastIteration = 0;
  let lastError: string | undefined;
  const checkpointProgress = config.checkpointStore?.getLoopProgress(
    loopStep.id
  );
  let startIteration = 1;
  let resumeSubStepIndex = 0;
  let skippedSubSteps = new Set<string>();

  if (checkpointProgress) {
    const validProgress = restoreLoopProgress(
      loopStep,
      config,
      checkpointProgress
    );
    if (validProgress) {
      startIteration = checkpointProgress.iteration;
      resumeSubStepIndex = checkpointProgress.nextSubStepIndex;
      skippedSubSteps = new Set(checkpointProgress.skippedSubSteps);

      // Invalidate checkpoint if the resumed iteration exceeds maxIterations
      // (e.g. workflow was edited to lower maxIterations between pause and resume)
      if (startIteration > maxIterations) {
        console.log(
          colors.yellow(
            `  ⚠ Checkpoint iteration ${startIteration} exceeds maxIterations ${maxIterations} — restarting loop "${loopStep.name}"`
          )
        );
        startIteration = 1;
        resumeSubStepIndex = 0;
        skippedSubSteps = new Set<string>();
        config.checkpointStore?.clearLoopProgress(loopStep.id);
      } else {
        const resumePointLabel =
          resumeSubStepIndex === loopStep.steps.length
            ? 'pending until check'
            : `sub-step ${resumeSubStepIndex + 1}`;
        console.log(
          colors.cyan(
            `  ↺ Resuming loop "${loopStep.name}" at iteration ${startIteration}, ${resumePointLabel}`
          )
        );
      }
    } else {
      console.log(
        colors.yellow(
          `  ⚠ Ignoring invalid checkpoint state for loop "${loopStep.name}"`
        )
      );
      config.checkpointStore?.clearLoopProgress(loopStep.id);
    }
  }

  console.log(
    colors.blue(
      `\n🔄 Starting loop "${loopStep.name}" (max ${maxIterations} iterations, until: ${loopStep.until})`
    )
  );

  for (
    let iteration = startIteration;
    iteration <= maxIterations;
    iteration++
  ) {
    lastIteration = iteration;
    console.log(
      colors.cyan(`\n  ↻ Loop iteration ${iteration}/${maxIterations}`)
    );

    const subStepStartIndex =
      iteration === startIteration ? resumeSubStepIndex : 0;

    for (
      let subStepIndex = subStepStartIndex;
      subStepIndex < loopStep.steps.length;
      subStepIndex++
    ) {
      const subStep = loopStep.steps[subStepIndex];
      // Check `if` condition on sub-steps (mirrors top-level skip in run.ts)
      if (shouldSkipStep(subStep, config.stepsOutput)) {
        console.log(
          colors.gray(`  ⏭ Skipping step "${subStep.name}" (condition not met)`)
        );
        config.stepsOutput.set(subStep.id, new Map());
        skippedSubSteps.add(subStep.id);
        persistLoopProgress(
          loopStep,
          config,
          iteration,
          subStepIndex + 1,
          skippedSubSteps
        );
        continue;
      }

      const subResult = await executeStep(subStep, {
        ...config,
        // Preserve parent context for progress reporting; sub-steps use the
        // loop's position within the overall workflow, not their own index.
      });

      // Store sub-step outputs
      config.stepsOutput.set(subStep.id, subResult.outputs);
      skippedSubSteps.delete(subStep.id);
      persistLoopProgress(
        loopStep,
        config,
        iteration,
        subStepIndex + 1,
        skippedSubSteps
      );

      if (!subResult.success) {
        lastError = subResult.error;
        console.log(
          colors.yellow(
            `  ⚠ Sub-step "${subStep.id}" failed: ${subResult.error}`
          )
        );
        // NOTE: Loop sub-steps intentionally continue past failures.
        // The `until` condition (checked at the end of each iteration)
        // determines when the loop exits.  This differs from top-level
        // `continueOnError` handling because loops are designed for retry
        // patterns (e.g. TDD: tests fail → fix agent runs → tests re-run).
      }
    }

    // Check the `until` condition after all sub-steps in this iteration
    // have completed.  We intentionally do NOT check after each sub-step
    // because the condition may reference steps that haven't run yet in
    // the current iteration (e.g. `steps.checkpoint.outputs.exit_code != 0`
    // would be true for an undefined step, causing premature exit).
    // Individual sub-steps already have `if` guards to skip unnecessary work.
    if (evaluateCondition(loopStep.until, config.stepsOutput)) {
      conditionMet = true;
      console.log(colors.green(`  ✓ Loop condition met, exiting loop`));
    }

    if (conditionMet) {
      config.checkpointStore?.clearLoopProgress(loopStep.id);
      break;
    }

    if (iteration < maxIterations) {
      persistLoopProgress(loopStep, config, iteration + 1, 0, skippedSubSteps);
    }
  }

  const duration = (performance.now() - start) / 1000;
  const outputs = new Map<string, string>();
  outputs.set('iterations', String(lastIteration));
  outputs.set('condition_met', String(conditionMet));

  if (!conditionMet) {
    config.checkpointStore?.clearLoopProgress(loopStep.id);
    console.log(
      colors.yellow(
        `  ⚠ Loop "${loopStep.name}" reached max iterations (${maxIterations}) without condition being met`
      )
    );
  }

  return {
    id: loopStep.id,
    success: conditionMet,
    error: conditionMet
      ? undefined
      : lastError || `Loop condition not met after ${maxIterations} iterations`,
    duration,
    outputs,
  };
}
