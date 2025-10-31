import { getAIAgentTool, getUserAIAgent } from '../agents/index.js';
import { join } from 'node:path';
import { AI_AGENT, ProjectConfig } from '../config.js';
import { Sandbox } from './types.js';
import { SetupBuilder } from '../setup.js';
import { TaskDescription } from '../description.js';
import { findProjectRoot, launch, ProcessManager } from 'rover-common';
import {
  parseCustomEnvironmentVariables,
  loadEnvsFile,
} from '../../utils/env-variables.js';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { generateRandomId } from '../../utils/branch-name.js';
import {
  AGENT_IMAGE,
  ContainerBackend,
  etcPasswdWithUserInfo,
  etcGroupWithUserInfo,
} from './container-common.js';

export class PodmanSandbox extends Sandbox {
  backend = ContainerBackend.Podman;

  constructor(task: TaskDescription, processManager?: ProcessManager) {
    super(task, processManager);
  }

  async isBackendAvailable(): Promise<boolean> {
    try {
      await launch('podman', ['--version']);
      return true;
    } catch (error) {
      return false;
    }
  }

  protected async create(): Promise<string> {
    // Load task description
    const roverPath = join(findProjectRoot(), '.rover');
    const tasksPath = join(roverPath, 'tasks');
    const taskPath = join(tasksPath, this.task.id.toString());
    const worktreePath = join(taskPath, 'workspace');
    const iterationPath = join(
      taskPath,
      'iterations',
      this.task.iterations.toString()
    );
    const iterationJsonPath = join(
      this.task.iterationsPath(),
      this.task.iterations.toString(),
      'iteration.json'
    );

    // Generate setup script using SetupBuilder
    const setupBuilder = new SetupBuilder(this.task, this.task.agent!);
    const entrypointScriptPath = setupBuilder.generateEntrypoint();
    const inputsPath = setupBuilder.generateInputs();
    const workflowPath = setupBuilder.saveWorkflow(this.task.workflowName);

    // Get agent-specific container mounts
    const agent = getAIAgentTool(this.task.agent!);
    const containerMounts: string[] = agent.getContainerMounts();
    const envVariables: string[] = agent.getEnvironmentVariables();

    // Load project config and merge custom environment variables
    const projectRoot = findProjectRoot();
    let customEnvVariables: string[] = [];

    if (ProjectConfig.exists()) {
      try {
        const projectConfig = ProjectConfig.load();

        // Parse custom envs array
        if (projectConfig.envs && projectConfig.envs.length > 0) {
          customEnvVariables = parseCustomEnvironmentVariables(
            projectConfig.envs
          );
        }

        // Load envs from file
        if (projectConfig.envsFile) {
          const fileEnvVariables = loadEnvsFile(
            projectConfig.envsFile,
            projectRoot
          );
          customEnvVariables = [...customEnvVariables, ...fileEnvVariables];
        }
      } catch (error) {
        // Silently skip if there's an error loading project config
      }
    }

    // Merge agent environment variables with custom environment variables
    // IMPORTANT: Custom environment variables are appended after agent defaults.
    // In Podman, when the same environment variable appears multiple times, the last
    // occurrence takes precedence. This means custom environment variables will
    // override agent defaults if there are conflicts, which is the desired behavior.
    const allEnvVariables = [...envVariables, ...customEnvVariables];

    // Clean up any existing container with same name
    try {
      await launch('podman', ['rm', '-f', this.sandboxName]);
    } catch (error) {
      // Container doesn't exist, which is fine
    }

    const podmanArgs = ['create', '--name', this.sandboxName];

    const userInfo_ = userInfo();

    const userCredentialsTempPath = mkdtempSync(join(tmpdir(), 'rover-'));
    const etcPasswd = join(userCredentialsTempPath, 'passwd');
    const [etcPasswdContents, username] = await etcPasswdWithUserInfo(
      ContainerBackend.Podman,
      AGENT_IMAGE,
      userInfo_
    );
    writeFileSync(etcPasswd, etcPasswdContents);

    const etcGroup = join(userCredentialsTempPath, 'group');
    const [etcGroupContents, group] = await etcGroupWithUserInfo(
      ContainerBackend.Podman,
      AGENT_IMAGE,
      userInfo_
    );
    writeFileSync(etcGroup, etcGroupContents);

    podmanArgs.push(
      '-v',
      `${etcPasswd}:/etc/passwd:Z,ro`,
      '-v',
      `${etcGroup}:/etc/group:Z,ro`,
      '--user',
      `${userInfo_.uid}:${userInfo_.gid}`,
      '-v',
      `${worktreePath}:/workspace:Z,rw`,
      '-v',
      `${iterationPath}:/output:Z,rw`,
      ...containerMounts,
      '-v',
      `${entrypointScriptPath}:/entrypoint.sh:Z,ro`,
      '-v',
      `${workflowPath}:/workflow.yml:Z,ro`,
      '-v',
      `${inputsPath}:/inputs.json:Z,ro`,
      '-v',
      `${iterationJsonPath}:/task/description.json:Z,ro`,
      ...allEnvVariables,
      '-w',
      '/workspace',
      '--entrypoint',
      '/entrypoint.sh',
      AGENT_IMAGE,
      'rover-agent',
      'run',
      '/workflow.yml',
      '--agent-tool',
      this.task.agent!,
      '--task-id',
      this.task.id.toString(),
      '--status-file',
      '/output/status.json',
      '--output',
      '/output',
      '--inputs-json',
      '/inputs.json'
    );

    return (
      (await launch('podman', podmanArgs)).stdout?.toString().trim() ||
      this.sandboxName
    );
  }

  protected async start(): Promise<string> {
    return (
      (
        await launch('podman', ['start', this.sandboxName], { stdio: 'pipe' })
      ).stdout
        ?.toString()
        .trim() || this.sandboxName
    );
  }

  protected async remove(): Promise<string> {
    return (
      (
        await launch('podman', ['rm', '-f', this.sandboxName], {
          stdio: 'pipe',
        })
      ).stdout
        ?.toString()
        .trim() || this.sandboxName
    );
  }

  protected async stop(): Promise<string> {
    return (
      (
        await launch('podman', ['stop', this.sandboxName], { stdio: 'pipe' })
      ).stdout
        ?.toString()
        .trim() || this.sandboxName
    );
  }

  protected async logs(): Promise<string> {
    return (
      (
        await launch('podman', ['logs', this.sandboxName], { stdio: 'pipe' })
      ).stdout?.toString() || ''
    );
  }

  protected async *followLogs(): AsyncIterable<string> {
    const process = launch('podman', ['logs', '--follow', this.sandboxName]);

    if (!process.stdout) {
      return;
    }

    // Stream stdout line by line
    for await (const chunk of process.stdout) {
      yield chunk.toString();
    }
  }

  async openShellAtWorktree(): Promise<void> {
    // Check if worktree exists
    if (!this.task.worktreePath || !existsSync(this.task.worktreePath)) {
      throw new Error('No worktree found for this task');
    }

    // Generate a unique container name for the interactive shell
    const containerName = `rover-shell-${this.task.id}-${generateRandomId()}`;

    // Build Podman run command for interactive shell
    const podmanArgs = [
      'run',
      '--rm', // Remove container when it exits
      '-it', // Interactive with TTY
      '--name',
      containerName,
      '-v',
      `${this.task.worktreePath}:/workspace:Z,rw`,
      '-w',
      '/workspace',
      'node:24-alpine',
      '/bin/sh',
    ];

    // Start Podman container with direct stdio inheritance for true interactivity
    await launch('podman', podmanArgs, {
      reject: false,
      stdio: 'inherit', // This gives full control to the user
    });
  }
}
