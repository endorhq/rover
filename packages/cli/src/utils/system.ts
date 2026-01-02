/**
 * An utility library to check the existence of different tools and commands.
 */
import { launch } from 'rover-core';

const checkCommand = async (
  command: string,
  args: string[] = ['--version']
): Promise<boolean> => {
  try {
    await launch(command, args);
    return true;
  } catch {
    return false;
  }
};

export const checkGit = async (): Promise<boolean> => await checkCommand('git');
export const checkGitHubCLI = async (): Promise<boolean> =>
  await checkCommand('gh');
export const checkDocker = async (): Promise<boolean> =>
  await checkCommand('docker');
export const checkClaude = async (): Promise<boolean> =>
  await checkCommand('claude');
export const checkCodex = async (): Promise<boolean> =>
  await checkCommand('codex');
export const checkCursor = async (): Promise<boolean> =>
  await checkCommand('cursor-agent');
export const checkQwen = async (): Promise<boolean> =>
  await checkCommand('qwen');
export const checkGemini = async (): Promise<boolean> =>
  await checkCommand('gemini');
