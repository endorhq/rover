import { launch, ProjectConfigManager } from 'rover-core';
import colors from 'ansi-colors';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, UserInfo } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Dynamically resolves the default agent image based on CLI version.
 * Allows override via ROVER_AGENT_IMAGE environment variable.
 *
 * @returns The default agent image tag
 */
export function getDefaultAgentImage(): string {
  // Allow override via environment variable
  if (process.env.ROVER_AGENT_IMAGE) {
    return process.env.ROVER_AGENT_IMAGE;
  }

  // Load from package.json version
  try {
    // After bundling, the code is in dist/index.js, so we need to go up one level
    const packageJsonPath = join(__dirname, '../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const version = packageJson.version;

    // Use local image for dev versions, remote image for production
    if (version.includes('-dev')) {
      return 'rover-agent-local:latest';
    } else {
      return `ghcr.io/endorhq/rover/agent:v${version}`;
    }
  } catch (_err) {
    return 'rover-agent-local:latest';
  }
}

/**
 * Resolves the agent image to use, with precedence:
 * 1. ROVER_AGENT_IMAGE environment variable
 * 2. storedImage from task (if provided)
 * 3. agentImage from ProjectConfig
 * 4. Default image based on CLI version
 */
export function resolveAgentImage(
  projectConfig?: ProjectConfigManager,
  storedImage?: string
): string {
  // Check environment variable first
  const envImage = process.env.ROVER_AGENT_IMAGE;
  if (envImage) {
    return envImage;
  }

  // Check stored image from task if available
  if (storedImage) {
    return storedImage;
  }

  // Check project config if available
  if (projectConfig?.agentImage) {
    return projectConfig.agentImage;
  }

  // Fall back to default image
  return getDefaultAgentImage();
}

/**
 * Checks if a custom agent image is being used and prints a warning if so
 */
export function warnIfCustomImage(projectConfig?: ProjectConfigManager): void {
  const envImage = process.env.ROVER_AGENT_IMAGE;
  const configImage = projectConfig?.agentImage;

  // Only warn if a custom image is configured (not using the default)
  if (envImage || configImage) {
    const customImage = envImage || configImage;
    const defaultImage = getDefaultAgentImage();
    console.log(
      colors.yellow(
        '\n⚠ Note: Using custom agent image: ' + colors.cyan(customImage!)
      )
    );
    console.log(
      colors.yellow(
        '  This might have side effects on the expected behavior of Rover if this image is incompatible'
      )
    );
    console.log(
      colors.yellow('  with the reference image: ' + colors.cyan(defaultImage))
    );
  }
}

export type CurrentUser = string;
export type CurrentGroup = string;

export enum ContainerBackend {
  Docker = 'docker',
  Podman = 'podman',
}

export async function catFile(
  backend: ContainerBackend,
  image: string,
  file: string
): Promise<string> {
  try {
    return (
      (
        await launch(backend, [
          'run',
          '--entrypoint',
          '/bin/cat',
          '--rm',
          image,
          file,
        ])
      ).stdout
        ?.toString()
        .trim() || ''
    );
  } catch (error) {
    return '';
  }
}

export async function imageUids(
  backend: ContainerBackend,
  image: string
): Promise<Map<number, string>> {
  const passwdContent = await catFile(backend, image, '/etc/passwd');
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

export async function imageGids(
  backend: ContainerBackend,
  image: string
): Promise<Map<number, string>> {
  const groupContent = await catFile(backend, image, '/etc/group');
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

export async function etcPasswdWithUserInfo(
  backend: ContainerBackend,
  image: string,
  userInfo: { uid: number; gid: number }
): Promise<[string, CurrentUser]> {
  const originalPasswd = await catFile(backend, image, '/etc/passwd');
  const existingUids = await imageUids(backend, image);

  // Check if current user already exists in the image
  if (existingUids.has(userInfo.uid)) {
    return [originalPasswd, existingUids.get(userInfo.uid)!];
  }

  // Create entry for current user
  const userEntry = `agent:x:${userInfo.uid}:${userInfo.gid}:agent:/home/agent:/bin/sh`;

  return [originalPasswd + '\n' + userEntry + '\n', 'agent'];
}

export async function etcGroupWithUserInfo(
  backend: ContainerBackend,
  image: string,
  userInfo: { uid: number; gid: number }
): Promise<[string, CurrentGroup]> {
  const originalGroup = await catFile(backend, image, '/etc/group');
  const existingGids = await imageGids(backend, image);

  // Check if current group already exists in the image
  if (existingGids.has(userInfo.gid)) {
    return [originalGroup, existingGids.get(userInfo.gid)!];
  }

  // Create entry for current group
  const groupEntry = `agent:x:${userInfo.gid}:agent`;

  return [originalGroup + '\n' + groupEntry + '\n', 'agent'];
}

/**
 * Generate the user and group files to mount on the image. It contains
 * the user and group id from the host user to ensure a correct permission
 * handling when possible.
 *
 * The Docker rootless mode does not support user namespaces, so the permissions
 * will still be different from the host user.
 */
export async function tmpUserGroupFiles(
  containerBackend: ContainerBackend,
  agentImage: string,
  userInfo: UserInfo<string>
): Promise<[string, string]> {
  const userCredentialsTempPath = mkdtempSync(join(tmpdir(), 'rover-'));
  const etcPasswd = join(userCredentialsTempPath, 'passwd');
  const [etcPasswdContents, _username] = await etcPasswdWithUserInfo(
    containerBackend,
    agentImage,
    userInfo
  );
  writeFileSync(etcPasswd, etcPasswdContents);

  const etcGroup = join(userCredentialsTempPath, 'group');
  const [etcGroupContents, _group] = await etcGroupWithUserInfo(
    containerBackend,
    agentImage,
    userInfo
  );
  writeFileSync(etcGroup, etcGroupContents);

  return [etcPasswd, etcGroup];
}

/**
 * Normalize extra args from string or array format to a flat array of arguments.
 * Handles both:
 * - String format: "--network mynet --memory 512m" (splits by whitespace, respecting quotes)
 * - Array format: ["--network", "mynet", "--memory", "512m"]
 *
 * @param extraArgs - String or array of extra arguments
 * @returns Flat array of arguments
 */
/**
 * Returns volume mount args needed for git worktree support inside containers.
 *
 * Git worktrees use a `.git` file (not directory) that references the parent
 * repo's `.git/worktrees/<id>` metadata directory via an absolute host path.
 * When only `/workspace` is mounted, git commands inside the container fail
 * because the referenced host path doesn't exist in the container.
 *
 * This function detects worktrees and returns mount args for the parent `.git`
 * directory so that the worktree metadata path resolves correctly.
 */
export function getWorktreeGitMounts(worktreePath: string): string[] {
  const dotGitPath = join(worktreePath, '.git');

  // Only applies when .git is a file (worktree), not a directory (regular repo)
  if (!existsSync(dotGitPath) || statSync(dotGitPath).isDirectory()) {
    return [];
  }

  try {
    const content = readFileSync(dotGitPath, 'utf-8').trim();
    const match = content.match(/^gitdir:\s*(.+)$/);
    if (!match) {
      return [];
    }

    // Resolve the gitdir path (e.g. /home/.../repo/.git/worktrees/13)
    const gitdirPath = resolve(worktreePath, match[1]);

    // The parent .git directory is 2 levels up from the worktree metadata dir
    // e.g. /home/.../repo/.git/worktrees/13 -> /home/.../repo/.git
    const parentGitDir = resolve(gitdirPath, '../..');

    // Sanity check: the resolved path should end with .git and exist
    if (!parentGitDir.endsWith('.git') || !existsSync(parentGitDir)) {
      return [];
    }

    return [
      // Mount parent .git dir read-only (refs, config, hooks, etc.)
      '-v',
      `${parentGitDir}:${parentGitDir}:Z,ro`,
      // Mount object store read-write (append-only, needed for creating commits)
      '-v',
      `${join(parentGitDir, 'objects')}:${join(parentGitDir, 'objects')}:Z,rw`,
      // Mount worktree metadata subdir read-write (HEAD, index, etc.)
      '-v',
      `${gitdirPath}:${gitdirPath}:Z,rw`,
    ];
  } catch {
    return [];
  }
}

/**
 * Returns rover-agent CLI flags to pass a checkpoint file path.
 * The checkpoint file lives inside the iteration directory (already
 * mounted at /output), so we reference it via /output/checkpoint.json
 * instead of adding a separate bind-mount. These args are appended
 * after the image name in the container create command.
 *
 * The container path is always `/output/checkpoint.json` regardless of the
 * host filename because the iteration directory is bind-mounted at `/output`
 * and the agent always writes checkpoints as `checkpoint.json` within it.
 */
export function getCheckpointArgs(checkpointPath?: string): string[] {
  if (checkpointPath && existsSync(checkpointPath)) {
    return ['--checkpoint', '/output/checkpoint.json'];
  }
  return [];
}

export function normalizeExtraArgs(
  extraArgs: string | string[] | undefined
): string[] {
  if (!extraArgs) return [];
  if (Array.isArray(extraArgs)) return extraArgs;
  // Split string by whitespace, respecting quoted strings
  return extraArgs.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
}
