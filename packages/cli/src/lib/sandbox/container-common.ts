import { launch } from 'rover-common';
import { ProjectConfigManager } from 'rover-schemas';
import colors from 'ansi-colors';

export const AGENT_IMAGE = 'ghcr.io/endorhq/rover/node:v1.3.4';

/**
 * Resolves the agent image to use, with precedence:
 * 1. AGENT_IMAGE environment variable
 * 2. agentImage from ProjectConfig
 * 3. AGENT_IMAGE constant (default)
 */
export function resolveAgentImage(
  projectConfig?: ProjectConfigManager
): string {
  // Check environment variable first
  const envImage = process.env.AGENT_IMAGE;
  if (envImage) {
    return envImage;
  }

  // Check project config if available
  if (projectConfig?.agentImage) {
    return projectConfig.agentImage;
  }

  // Fall back to default constant
  return AGENT_IMAGE;
}

/**
 * Checks if a custom agent image is being used and prints a warning if so
 */
export function warnIfCustomImage(projectConfig?: ProjectConfigManager): void {
  const envImage = process.env.AGENT_IMAGE;
  const configImage = projectConfig?.agentImage;

  // Only warn if a custom image is configured (not using the default)
  if (envImage || configImage) {
    const customImage = envImage || configImage;
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
      colors.yellow('  with the reference image: ' + colors.cyan(AGENT_IMAGE))
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
