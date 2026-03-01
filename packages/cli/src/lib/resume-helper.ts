import { join } from 'node:path';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  readFileSync,
} from 'node:fs';
import { generateBranchName } from '../utils/branch-name.js';
import {
  IterationManager,
  IterationStatusManager,
  Git,
  ProjectConfigManager,
  VERBOSE,
  type ProjectManager,
} from 'rover-core';
import { TaskNotFoundError } from 'rover-schemas';
import { createSandbox } from '../lib/sandbox/index.js';
import { copyEnvironmentFiles } from '../utils/env-files.js';
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

  const isProcessAlive = (pid: number): boolean => {
    if (!Number.isInteger(pid) || pid <= 0) {
      return false;
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // EPERM means the process exists but we are not allowed to signal it.
      if (code === 'EPERM') {
        return true;
      }
      if (code === 'ESRCH') {
        return false;
      }
      return false;
    }
  };

  const release = tryAcquireLock();
  if (release) {
    return release;
  }

  try {
    // Lock file already exists — only reclaim if the owning PID is invalid/dead.
    const content = readFileSync(lockPath, 'utf8');
    const lockPid = parseInt(content, 10);

    const processAlive = isProcessAlive(lockPid);
    // Never steal a lock from a live owner, even if it's old.
    if (!processAlive) {
      // Reclaim the stale lock: unlink the dead process's lock file, then
      // re-acquire with O_EXCL.  This avoids the TOCTOU window in the old
      // rename-based approach where a concurrent O_EXCL acquirer could be
      // overwritten by the rename.
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
  } catch (err) {
    // Log unreadable lock files (e.g. permission denied) instead of silently ignoring
    if (VERBOSE) {
      console.warn(`Warning: could not read lock file ${lockPath}:`, err);
    }
  }
  return null;
}

/**
 * Core resume logic extracted for reuse by both the `resume` command
 * and the automatic RetryScheduler.
 *
 * @returns true if the sandbox was started successfully, false otherwise.
 */
export async function resumeTask(
  project: ProjectManager,
  taskId: number
): Promise<boolean> {
  const task = project.getTask(taskId);
  if (!task) {
    throw new TaskNotFoundError(taskId);
  }

  // Only PAUSED or FAILED tasks can be resumed
  if (!task.isPaused() && !task.isFailed()) {
    return false;
  }

  // Find checkpoint.json in the last iteration's output directory
  if (!task.iterations || task.iterations < 1) {
    console.log(
      colors.yellow(
        `  ⚠ Task ${taskId} has no iterations (iterations=${task.iterations}), cannot resume.`
      )
    );
    return false;
  }
  const iterationPath = join(task.iterationsPath(), task.iterations.toString());

  // Acquire file-based lock to prevent concurrent resume attempts
  // (e.g. manual `rover resume` racing with auto-retry from `rover list --watch`)
  mkdirSync(iterationPath, { recursive: true });
  const releaseLock = acquireResumeLock(iterationPath);
  if (!releaseLock) {
    console.log(
      colors.yellow(
        `  ⚠ Task ${taskId} is already being resumed by another process, skipping.`
      )
    );
    return false;
  }

  try {
    return await resumeTaskLocked(project, taskId, iterationPath);
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
  iterationPath: string
): Promise<boolean> {
  // Re-read task from disk under lock — another process may have already
  // resumed the task between our initial check and lock acquisition.
  const task = project.getTask(taskId);
  if (!task || (!task.isPaused() && !task.isFailed())) {
    return false;
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
      console.log(
        colors.yellow(
          `  ⚠ Failed to create worktree for task ${taskId}: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      return false;
    }
  }

  // Update task metadata when the worktree was freshly created or metadata
  // is missing (e.g. task predates worktree tracking, or metadata was lost)
  if (worktreeCreated || !task.worktreePath || !task.branchName) {
    task.setWorkspace(worktreePath, branchName);
  }

  // Create initial iteration.json if it doesn't exist
  // (iterationPath was already created before lock acquisition)
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
  const iterationStatus = IterationStatusManager.createInitial(
    statusJsonPath,
    String(task.id),
    'Resuming workflow'
  );

  // Check if user provided a custom agent image via environment variable
  if (process.env.ROVER_AGENT_IMAGE) {
    task.setAgentImage(process.env.ROVER_AGENT_IMAGE);
  }

  // Start sandbox container for task execution
  try {
    const sandbox = await createSandbox(task, undefined, {
      projectPath: project.path,
      checkpointPath: hasCheckpoint ? checkpointPath : undefined,
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

    return true;
  } catch (error) {
    console.log(
      colors.yellow(
        `  ⚠ Sandbox start failed for task ${taskId}: ${error instanceof Error ? error.message : String(error)}`
      )
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
    return false;
  }
}
