import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  ProjectConfigManager,
  IterationManager,
  Git,
  ContextManager,
  generateContextIndex,
  registerBuiltInProviders,
  type TaskDescriptionManager,
  type ProjectManager,
  type ProcessManager,
  type ContextIndexOptions,
} from 'rover-core';
import { createSandbox } from './sandbox/index.js';
import { resolveAgentImage } from './sandbox/container-common.js';
import { copyEnvironmentFiles } from '../utils/env-files.js';

interface FetchContextOptions {
  bestEffort?: boolean;
  readContent?: boolean;
  trustAllAuthors?: boolean;
  trustedAuthors?: string[];
  iterationArtifacts?: {
    summaries: Array<{ iteration: number; content: string }>;
    plans: Array<{ iteration: number; content: string }>;
  };
}

interface StartOptions {
  processManager?: ProcessManager;
  extraArgs?: string;
}

export class TaskSetup {
  private project: ProjectManager;
  private task: TaskDescriptionManager;
  private projectConfig?: ProjectConfigManager;
  private iteration?: IterationManager;
  private workspaceReady = false;
  private iterationReady = false;

  private constructor(project: ProjectManager, task: TaskDescriptionManager) {
    this.project = project;
    this.task = task;
  }

  /**
   * Create a TaskSetup for a new task: sets up worktree, env files, sparse
   * checkout, base commit, and marks the task in-progress.
   */
  static initial(
    project: ProjectManager,
    task: TaskDescriptionManager,
    git: Git,
    branchName: string,
    baseBranch: string
  ): TaskSetup {
    const setup = new TaskSetup(project, task);

    const worktreePath = project.getWorkspacePath(task.id);
    git.createWorktree(worktreePath, branchName, baseBranch);

    const baseCommit = git.getCommitHash('HEAD', { worktreePath });
    if (baseCommit) {
      task.setBaseCommit(baseCommit);
    }

    copyEnvironmentFiles(project.path, worktreePath);

    const projectConfig = ProjectConfigManager.load(project.path);
    setup.projectConfig = projectConfig;
    if (
      projectConfig.excludePatterns &&
      projectConfig.excludePatterns.length > 0
    ) {
      git.setupSparseCheckout(worktreePath, projectConfig.excludePatterns);
    }

    task.setWorkspace(worktreePath, branchName);
    task.markInProgress();

    setup.workspaceReady = true;
    return setup;
  }

  /**
   * Create a TaskSetup for an existing task (iterate path).
   * Workspace and iteration already exist.
   */
  static iteration(
    project: ProjectManager,
    task: TaskDescriptionManager
  ): TaskSetup {
    const setup = new TaskSetup(project, task);
    setup.workspaceReady = true;
    setup.iterationReady = true;
    return setup;
  }

  /**
   * Create an initial iteration for the task.
   * Only callable after workspace is ready.
   */
  createIteration(title: string, description: string): IterationManager {
    if (!this.workspaceReady) {
      throw new Error('Cannot create iteration: workspace is not ready');
    }

    const iterationPath = join(
      this.task.iterationsPath(),
      this.task.iterations.toString()
    );
    mkdirSync(iterationPath, { recursive: true });

    const iteration = IterationManager.createInitial(
      iterationPath,
      this.task.id,
      title,
      description
    );

    this.iteration = iteration;
    this.iterationReady = true;
    return iteration;
  }

  /**
   * Set an externally-created iteration (used by the iterate command).
   */
  setIteration(iteration: IterationManager): void {
    this.iteration = iteration;
    this.iterationReady = true;
  }

  /**
   * Fetch context URIs and store them in the iteration.
   * Requires an iteration to be set.
   */
  async fetchContext(
    contextUris: string[],
    opts?: FetchContextOptions
  ): Promise<{
    entries: Array<{ name: string; uri: string; description: string }>;
    content?: string;
  }> {
    if (!this.iteration) {
      throw new Error('Cannot fetch context: iteration is not set');
    }

    const hasArtifacts =
      opts?.iterationArtifacts &&
      (opts.iterationArtifacts.summaries.length > 0 ||
        opts.iterationArtifacts.plans.length > 0);

    if (contextUris.length === 0 && !hasArtifacts) {
      return { entries: [] };
    }

    try {
      registerBuiltInProviders();

      const contextManager = new ContextManager(contextUris, this.task, {
        trustAllAuthors: opts?.trustAllAuthors,
        trustedAuthors: opts?.trustedAuthors,
        cwd: this.project.path,
      });

      const entries = await contextManager.fetchAndStore();
      this.iteration.setContext(entries);

      // Copy plan files into context directory and build references
      let iterationPlans: ContextIndexOptions['iterationPlans'];
      if (opts?.iterationArtifacts) {
        iterationPlans = [];
        for (const plan of opts.iterationArtifacts.plans) {
          const planFilename = `plan-iter-${plan.iteration}.md`;
          writeFileSync(
            join(contextManager.getContextDir(), planFilename),
            plan.content
          );
          iterationPlans.push({
            iteration: plan.iteration,
            file: planFilename,
          });
        }
      }

      const indexContent = generateContextIndex(
        entries,
        this.task.iterations,
        opts?.iterationArtifacts
          ? {
              iterationSummaries: opts.iterationArtifacts.summaries,
              iterationPlans,
            }
          : undefined
      );
      writeFileSync(
        join(contextManager.getContextDir(), 'index.md'),
        indexContent
      );

      let content: string | undefined;
      if (opts?.readContent) {
        const expansionEntries = entries.filter(
          entry => !(entry.metadata?.type || '').includes('pr')
        );
        const storedContent =
          contextManager.readStoredContent(expansionEntries);
        if (storedContent) {
          content = storedContent;
        }
      }

      return { entries, content };
    } catch (error) {
      if (opts?.bestEffort) {
        return { entries: [] };
      }
      throw error;
    }
  }

  /**
   * Validate readiness and start the sandbox container.
   * Returns the container ID.
   */
  async start(opts?: StartOptions): Promise<string> {
    if (!this.workspaceReady) {
      throw new Error('Cannot start: workspace is not ready');
    }
    if (!this.iterationReady) {
      throw new Error('Cannot start: iteration is not ready');
    }

    if (this.projectConfig) {
      const agentImage = resolveAgentImage(this.projectConfig);
      this.task.setAgentImage(agentImage);
    }

    const sandbox = await createSandbox(this.task, opts?.processManager, {
      extraArgs: opts?.extraArgs,
      projectPath: this.project.path,
      iterationLogsPath: this.project.getTaskIterationLogsPath(
        this.task.id,
        this.task.iterations
      ),
    });
    const containerId = await sandbox.createAndStart();

    this.task.setContainerInfo(
      containerId,
      'running',
      process.env.DOCKER_HOST
        ? { dockerHost: process.env.DOCKER_HOST }
        : undefined
    );

    return containerId;
  }

  get worktreePath(): string {
    return this.task.worktreePath;
  }

  get branchName(): string {
    return this.task.branchName;
  }

  getProjectConfig(): ProjectConfigManager | undefined {
    return this.projectConfig;
  }
}
