import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { generateBranchName } from '../utils/branch-name.js';
import {
  IterationManager,
  IterationStatusManager,
  Git,
  ProjectConfigManager,
  type ProjectManager,
} from 'rover-core';
import { TaskNotFoundError } from 'rover-schemas';
import { createSandbox } from '../lib/sandbox/index.js';
import { copyEnvironmentFiles } from '../utils/env-files.js';
import { isResumeLockActive } from '../utils/resume-lock.js';
import colors from 'ansi-colors';

/**
 * Acquire a file-based lock for a task resume operation.
 * Prevents concurrent resume attempts (manual + auto-retry) from racing.
 * Returns a release function, or null if the lock is already held.
 */
function acquireResumeLock(iterationPath: string): (() => void) | null {
  const lockPath = join(iterationPath, '.resume.lock');

  const tryAcquireLock = (): (() => void) | null => {
    try {
      // O_EXCL semantics: writeFileSync with flag 'wx' fails if file exists
      writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return () => {
        try {
          unlinkSync(lockPath);
        } catch {}
      };
    } catch {
      return null;
    }
  };

  const release = tryAcquireLock();
  if (release) {
    return release;
  }

  // Lock file already exists — only reclaim if the owning PID is dead.
  // Reuse isResumeLockActive to avoid duplicating PID-checking logic.
  if (isResumeLockActive(iterationPath)) {
    // Lock is held by a live process — do not steal it.
    return null;
  }

  // The owning process is dead — reclaim the stale lock.
  try {
    unlinkSync(lockPath);
  } catch {
    // Another process may have already reclaimed or removed the lock
    return null;
  }
  // Re-attempt O_EXCL acquisition — if another process raced us and
  // acquired first, this will correctly fail and we return null.
  return tryAcquireLock();
}

/** Possible outcomes of a resume attempt. */
export type ResumeResult =
  | { status: 'ok' }
  | { status: 'not_resumable' }
  | { status: 'already_resuming' }
  | { status: 'failed'; error: string };

/**
 * Core resume logic extracted for reuse by both the `resume` command
 * and the automatic RetryScheduler.
 */
export interface ResumeOptions {
  /** Suppress informational console.log messages (e.g. in JSON mode). */
  quiet?: boolean;
}

export async function resumeTask(
  project: ProjectManager,
  taskId: number,
  options: ResumeOptions = {}
): Promise<ResumeResult> {
  const log = options.quiet ? () => {} : console.log;

  const task = project.getTask(taskId);
  if (!task) {
    throw new TaskNotFoundError(taskId);
  }

  // Only PAUSED or FAILED tasks can be resumed
  if (!task.isPaused() && !task.isFailed()) {
    return { status: 'not_resumable' };
  }

  // Find checkpoint.json in the last iteration's output directory
  if (!task.iterations || task.iterations < 1) {
    log(
      colors.yellow(
        `  ⚠ Task ${taskId} has no iterations (iterations=${task.iterations}), cannot resume.`
      )
    );
    return { status: 'not_resumable' };
  }
  const iterationPath = join(task.iterationsPath(), task.iterations.toString());

  // Acquire file-based lock to prevent concurrent resume attempts
  // (e.g. manual `rover resume` racing with auto-retry from `rover list --watch`)
  mkdirSync(iterationPath, { recursive: true });
  const releaseLock = acquireResumeLock(iterationPath);
  if (!releaseLock) {
    log(
      colors.yellow(
        `  ⚠ Task ${taskId} is already being resumed by another process, skipping.`
      )
    );
    return { status: 'already_resuming' };
  }

  try {
    return await resumeTaskLocked(project, taskId, iterationPath, log);
  } finally {
    releaseLock();
  }
}

/**
 * Inner resume logic, called while holding the resume lock.
 */
async function resumeTaskLocked(
  project: ProjectManager,
  taskId: number,
  iterationPath: string,
  log: (...args: unknown[]) => void = console.log
): Promise<ResumeResult> {
  // Re-read task from disk under lock — another process may have already
  // resumed the task between our initial check and lock acquisition.
  const task = project.getTask(taskId);
  if (!task || (!task.isPaused() && !task.isFailed())) {
    return { status: 'not_resumable' };
  }

  const statusBeforeResume = task.status;
  const errorBeforeResume = task.error;

  const restoreResumableStatus = (fallbackError: string): void => {
    if (statusBeforeResume === 'FAILED') {
      task.markFailed(errorBeforeResume || fallbackError);
      return;
    }
    task.markPaused(errorBeforeResume || fallbackError);
  };

  // Atomically mark IN_PROGRESS before spawning container to prevent races.
  // NOTE: If the process crashes between this markInProgress() and the
  // restoreResumableStatus() call in the error paths below, the task will be
  // stuck in IN_PROGRESS with no container. The orphan detector
  // (detectOrphanedTasks) handles this by inspecting the container and
  // transitioning the task to FAILED so `rover resume` can recover it.
  task.markInProgress();

  const checkpointPath = join(iterationPath, 'checkpoint.json');
  const hasCheckpoint = existsSync(checkpointPath);

  // Ensure worktree exists and is valid
  let worktreePath = task.worktreePath;
  let branchName = task.branchName;

  if (!worktreePath) {
    worktreePath = project.getWorkspacePath(taskId);
  }
  if (!branchName) {
    branchName = generateBranchName(taskId);
  }

  let worktreeCreated = false;
  if (!existsSync(worktreePath)) {
    // Worktree doesn't exist on disk — create it
    try {
      const git = new Git({ cwd: project.path });
      const worktreeBaseRef = task.baseCommit || task.sourceBranch;
      git.createWorktree(worktreePath, branchName, worktreeBaseRef);

      // Copy user .env development files
      copyEnvironmentFiles(project.path, worktreePath);

      // Configure sparse checkout to exclude files matching exclude patterns
      const projectConfig = ProjectConfigManager.load(project.path);
      if (
        projectConfig.excludePatterns &&
        projectConfig.excludePatterns.length > 0
      ) {
        git.setupSparseCheckout(worktreePath, projectConfig.excludePatterns);
      }
      worktreeCreated = true;
    } catch (error) {
      restoreResumableStatus('Resume failed: worktree could not be prepared');
      const errorMsg = error instanceof Error ? error.message : String(error);
      log(
        colors.yellow(
          `  ⚠ Failed to create worktree for task ${taskId}: ${errorMsg}`
        )
      );
      return { status: 'failed', error: errorMsg };
    }
  }

  // Update task metadata when the worktree was freshly created or metadata
  // is missing (e.g. task predates worktree tracking, or metadata was lost)
  if (worktreeCreated || !task.worktreePath || !task.branchName) {
    task.setWorkspace(worktreePath, branchName);
  }

  // Create initial iteration.json and reset status.json.
  // If either fails (e.g. disk full, permissions), restore the task to its
  // pre-resume status so it remains resumable rather than stuck IN_PROGRESS.
  let iterationStatus: IterationStatusManager;
  try {
    const iterationJsonPath = join(iterationPath, 'iteration.json');
    if (!existsSync(iterationJsonPath)) {
      IterationManager.createInitial(
        iterationPath,
        task.id,
        task.title,
        task.description
      );
    }

    // Reset the iteration status so stale paused/failed state is not
    // re-read before the resumed agent writes its first status update.
    const statusJsonPath = join(iterationPath, 'status.json');
    iterationStatus = IterationStatusManager.createInitial(
      statusJsonPath,
      String(task.id),
      'Resuming workflow'
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(
      colors.yellow(
        `  ⚠ Failed to initialize iteration for task ${taskId}: ${errorMsg}`
      )
    );
    restoreResumableStatus('Resume failed: iteration initialization error');
    return { status: 'failed', error: errorMsg };
  }

  // Check if user provided a custom agent image via environment variable
  if (process.env.ROVER_AGENT_IMAGE) {
    task.setAgentImage(process.env.ROVER_AGENT_IMAGE);
  }

  // Start sandbox container for task execution
  try {
    const sandbox = await createSandbox(task, undefined, {
      projectPath: project.path,
      checkpointPath: hasCheckpoint ? checkpointPath : undefined,
      iterationLogsPath: project.getTaskIterationLogsPath(
        task.id,
        task.iterations
      ),
    });
    const containerId = await sandbox.createAndStart();

    // Update task metadata with new container ID
    task.setContainerInfo(
      containerId,
      'running',
      process.env.DOCKER_HOST
        ? { dockerHost: process.env.DOCKER_HOST }
        : undefined
    );
    // Task already marked IN_PROGRESS before container creation (under lock)

    return { status: 'ok' };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(
      colors.yellow(`  ⚠ Sandbox start failed for task ${taskId}: ${errorMsg}`)
    );
    if (statusBeforeResume === 'FAILED') {
      iterationStatus.fail(
        'Resuming workflow',
        'Resume failed: container could not start'
      );
    } else {
      iterationStatus.pause(
        'Resuming workflow',
        'Resume failed: container could not start'
      );
    }
    restoreResumableStatus('Resume failed: container could not start');
    return { status: 'failed', error: errorMsg };
  }
}
