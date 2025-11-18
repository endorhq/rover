import { getAIAgentTool, getUserAIAgent } from '../agents/index.js';
import { join } from 'node:path';
import { ProjectConfig } from '../config.js';
import { Sandbox } from './types.js';
import { SetupBuilder } from '../setup.js';
import { TaskDescriptionManager } from 'rover-schemas';
import {
  AI_AGENT,
  findProjectRoot,
  launch,
  ProcessManager,
} from 'rover-common';
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
  resolveAgentImage,
  warnIfCustomImage,
} from './container-common.js';
import { isJsonMode } from '../global-state.js';
import colors from 'ansi-colors';

export class DockerSandbox extends Sandbox {
  backend = ContainerBackend.Docker;

  constructor(task: TaskDescriptionManager, processManager?: ProcessManager) {
    super(task, processManager);
  }

  async isBackendAvailable(): Promise<boolean> {
    try {
      // Check if docker command exists and verify it's actual Docker (not Podman)
      const result = await launch('docker', ['info', '--format', 'json']);
      const info = JSON.parse(result.stdout?.toString() || '{}');

      // Docker will have ServerVersion set, Podman (even aliased as docker) will not
      return info.ServerVersion != null;
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

    // Get agent-specific Docker mounts
    const agent = getAIAgentTool(this.task.agent!);
    const dockerMounts: string[] = agent.getContainerMounts();
    const envVariables: string[] = agent.getEnvironmentVariables();

    // Load project config and merge custom environment variables
    const projectRoot = findProjectRoot();
    let customEnvVariables: string[] = [];
    let projectConfig: ProjectConfig | undefined;

    if (ProjectConfig.exists()) {
      try {
        projectConfig = ProjectConfig.load();

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
    // In Docker, when the same environment variable appears multiple times, the last
    // occurrence takes precedence. This means custom environment variables will
    // override agent defaults if there are conflicts, which is the desired behavior.
    const allEnvVariables = [...envVariables, ...customEnvVariables];

    // Clean up any existing container with same name
    try {
      await launch('docker', ['rm', '-f', this.sandboxName]);
    } catch (error) {
      // Container doesn't exist, which is fine
    }

    let isDockerRootless = false;

    const dockerInfo = (await launch('docker', ['info', '-f', 'json'])).stdout;
    if (dockerInfo) {
      const info = JSON.parse(dockerInfo.toString());
      isDockerRootless = (info?.SecurityOptions || []).some((value: string) =>
        value.includes('rootless')
      );
    }

    const dockerArgs = ['create', '--name', this.sandboxName];

    const userInfo_ = userInfo();

    // If we cannot retrieve the UID in the current environment,
    // set it to 1000, so that the Rover agent container will be
    // using this unprivileged UID. This happens typically on
    // environments such as Windows.
    if (userInfo_.uid === -1) {
      userInfo_.uid = 1000;
    }

    // If we cannot retrieve the GID in the current environment,
    // set it to 1000, so that the Rover agent container will be
    // using this unprivileged GID. This happens typically on
    // environments such as Windows.
    if (userInfo_.gid === -1) {
      userInfo_.gid = 1000;
    }

    // Resolve the agent image from env var, config, or default
    const agentImage = resolveAgentImage(projectConfig);

    // Warn if using a custom agent image
    warnIfCustomImage(projectConfig);

    const userCredentialsTempPath = mkdtempSync(join(tmpdir(), 'rover-'));
    const etcPasswd = join(userCredentialsTempPath, 'passwd');
    const [etcPasswdContents, username] = await etcPasswdWithUserInfo(
      ContainerBackend.Docker,
      agentImage,
      userInfo_
    );
    writeFileSync(etcPasswd, etcPasswdContents);

    const etcGroup = join(userCredentialsTempPath, 'group');
    const [etcGroupContents, group] = await etcGroupWithUserInfo(
      ContainerBackend.Docker,
      agentImage,
      userInfo_
    );
    writeFileSync(etcGroup, etcGroupContents);

    dockerArgs.push(
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
      ...dockerMounts,
      '-v',
      `${entrypointScriptPath}:/entrypoint.sh:Z,ro`,
      '-v',
      `${workflowPath}:/workflow.yml:Z,ro`,
      '-v',
      `${inputsPath}:/inputs.json:Z,ro`,
      '-v',
      `${iterationJsonPath}:/task/description.json:Z,ro`
    );

    // Mount initScript if provided in project config
    if (projectConfig?.initScript) {
      const initScriptAbsPath = join(projectRoot, projectConfig.initScript);
      if (existsSync(initScriptAbsPath)) {
        dockerArgs.push('-v', `${initScriptAbsPath}:/init-script.sh:Z,ro`);
      } else if (!isJsonMode()) {
        console.log(
          colors.yellow(
            `⚠ Warning: initScript '${projectConfig.initScript}' does not exist`
          )
        );
      }
    }

    dockerArgs.push(
      ...allEnvVariables,
      '-w',
      '/workspace',
      '--entrypoint',
      '/entrypoint.sh',
      agentImage,
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
      (await launch('docker', dockerArgs)).stdout?.toString().trim() ||
      this.sandboxName
    );
  }

  protected async start(): Promise<string> {
    return (
      (await launch('docker', ['start', this.sandboxName])).stdout
        ?.toString()
        .trim() || this.sandboxName
    );
  }

  protected async remove(): Promise<string> {
    return (
      (await launch('docker', ['rm', '-f', this.sandboxName])).stdout
        ?.toString()
        .trim() || this.sandboxName
    );
  }

  protected async stop(): Promise<string> {
    return (
      (await launch('docker', ['stop', this.sandboxName])).stdout
        ?.toString()
        .trim() || this.sandboxName
    );
  }

  protected async logs(): Promise<string> {
    return (
      (await launch('docker', ['logs', this.sandboxName])).stdout?.toString() ||
      ''
    );
  }

  protected async *followLogs(): AsyncIterable<string> {
    const process = launch('docker', ['logs', '--follow', this.sandboxName]);

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

    // Build Docker run command for interactive shell
    const dockerArgs = [
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

    // Start Docker container with direct stdio inheritance for true interactivity
    await launch('docker', dockerArgs, {
      reject: false,
      stdio: 'inherit', // This gives full control to the user
    });
  }
}
