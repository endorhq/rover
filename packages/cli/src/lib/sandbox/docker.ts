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

const AGENT_IMAGE = 'ghcr.io/endorhq/rover/node:v1.3.1';

export class DockerSandbox extends Sandbox {
  backend = 'docker';

  constructor(task: TaskDescription, processManager?: ProcessManager) {
    super(task, processManager);
  }

  async isBackendAvailable(): Promise<boolean> {
    try {
      await launch('docker', ['--version']);
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
    const workflowPath = setupBuilder.saveWorkflow();

    // Get agent-specific Docker mounts
    const agent = getAIAgentTool(this.task.agent!);
    const dockerMounts: string[] = agent.getContainerMounts();
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

    const userCredentialsTempPath = mkdtempSync(join(tmpdir(), 'rover-'));
    const etcPasswd = join(userCredentialsTempPath, 'passwd');
    const [etcPasswdContents, username] = await etcPasswdWithUserInfo(
      AGENT_IMAGE,
      userInfo_
    );
    writeFileSync(etcPasswd, etcPasswdContents);

    const etcGroup = join(userCredentialsTempPath, 'group');
    const [etcGroupContents, group] = await etcGroupWithUserInfo(
      AGENT_IMAGE,
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
      (await launch('docker', dockerArgs)).stdout?.toString().trim() ||
      this.sandboxName
    );
  }

  protected async start(): Promise<string> {
    return (
      (
        await launch('docker', ['start', this.sandboxName], { stdio: 'pipe' })
      ).stdout
        ?.toString()
        .trim() || this.sandboxName
    );
  }

  protected async remove(): Promise<string> {
    return (
      (
        await launch('docker', ['rm', '-f', this.sandboxName], {
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
        await launch('docker', ['stop', this.sandboxName], { stdio: 'pipe' })
      ).stdout
        ?.toString()
        .trim() || this.sandboxName
    );
  }

  protected async logs(): Promise<string> {
    return (
      (
        await launch('docker', ['logs', this.sandboxName], { stdio: 'pipe' })
      ).stdout?.toString() || ''
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

async function catFile(image: string, file: string): Promise<string> {
  try {
    return (
      (
        await launch('docker', [
          'run',
          '--entrypoint',
          '/bin/sh',
          '--rm',
          image,
          '-c',
          `/bin/cat ${file}`,
        ])
      ).stdout
        ?.toString()
        .trim() || ''
    );
  } catch (error) {
    return '';
  }
}

async function imageUids(image: string): Promise<Map<number, string>> {
  const passwdContent = await catFile(image, '/etc/passwd');
  const uidMap = new Map<number, string>();

  if (!passwdContent) {
    return uidMap;
  }

  const lines = passwdContent.split('\n').filter(line => line.trim());

  for (const line of lines) {
    const fields = line.split(':');
    if (fields.length >= 3) {
      const username = fields[0];
      const uid = parseInt(fields[2], 10);
      if (!isNaN(uid)) {
        uidMap.set(uid, username);
      }
    }
  }

  return uidMap;
}

async function imageGids(image: string): Promise<Map<number, string>> {
  const groupContent = await catFile(image, '/etc/group');
  const gidMap = new Map<number, string>();

  if (!groupContent) {
    return gidMap;
  }

  const lines = groupContent.split('\n').filter(line => line.trim());

  for (const line of lines) {
    const fields = line.split(':');
    if (fields.length >= 3) {
      const groupname = fields[0];
      const gid = parseInt(fields[2], 10);
      if (!isNaN(gid)) {
        gidMap.set(gid, groupname);
      }
    }
  }

  return gidMap;
}

type CurrentUser = string;

async function etcPasswdWithUserInfo(
  image: string,
  userInfo: { uid: number; gid: number }
): Promise<[string, CurrentUser]> {
  const originalPasswd = await catFile(image, '/etc/passwd');
  const existingUids = await imageUids(image);

  // Check if current user already exists in the image
  if (existingUids.has(userInfo.uid)) {
    return [originalPasswd, existingUids.get(userInfo.uid)!];
  }

  // Create entry for current user
  const userEntry = `agent:x:${userInfo.uid}:${userInfo.gid}:agent:/home/agent:/bin/sh`;

  return [originalPasswd + '\n' + userEntry + '\n', 'agent'];
}

type CurrentGroup = string;

async function etcGroupWithUserInfo(
  image: string,
  userInfo: { uid: number; gid: number }
): Promise<[string, CurrentGroup]> {
  const originalGroup = await catFile(image, '/etc/group');
  const existingGids = await imageGids(image);

  // Check if current group already exists in the image
  if (existingGids.has(userInfo.gid)) {
    return [originalGroup, existingGids.get(userInfo.gid)!];
  }

  // Create entry for current group
  const groupEntry = `agent:x:${userInfo.gid}:agent`;

  return [originalGroup + '\n' + groupEntry + '\n', 'agent'];
}
