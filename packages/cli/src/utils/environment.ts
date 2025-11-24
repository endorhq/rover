import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Environment } from '../types.js';
import type { Language, PackageManager, TaskManager } from 'rover-schemas';

/**
 * Identify project types based on the given files
 */
const LANGUAGE_FILES: Record<Language, string[]> = {
  typescript: ['tsconfig.json', 'tsconfig.node.json'],
  javascript: ['package.json', '.node-version'],
  php: ['composer.json', 'index.php', 'phpunit.xml'],
  rust: ['Cargo.toml'],
  go: ['go.mod', 'go.sum'],
  ruby: [
    '.ruby-version',
    'Procfile.dev',
    'Procfile.test',
    'Gemfile',
    'config.ru',
  ],
  python: ['pyproject.toml', 'uv.lock', 'setup.py', 'setup.cfg'],
};

/**
 * Identify package managers from files
 */
const PACKAGE_MANAGER_FILES: Record<PackageManager, string[]> = {
  npm: ['package-lock.json'],
  pnpm: ['pnpm-lock.yaml'],
  yarn: ['yarn.lock'],
  composer: ['composer.lock'],
  cargo: ['Cargo.toml', 'Cargo.lock'],
  gomod: ['go.mod', 'go.sum'],
  pip: ['pyproject.toml', '!poetry.lock', '!uv.lock'],
  poetry: ['poetry.lock'],
  uv: ['uv.lock'],
  rubygems: ['Gemfile', 'Gemfile.lock'],
};

/**
 * Identify task managers from files
 */
const TASK_MANAGER_FILES: Record<TaskManager, string[]> = {
  just: ['Justfile'],
  make: ['Makefile'],
  task: ['Taskfile.yml', 'Taskfile.yaml'],
};

/**
 * Check if files match the pattern (including negation support)
 * Returns true if ANY positive file exists AND ALL negative files don't exist
 */
function checkFilesMatch(projectPath: string, files: string[]): boolean {
  const positiveFiles = files.filter(f => !f.startsWith('!'));
  const negativeFiles = files
    .filter(f => f.startsWith('!'))
    .map(f => f.substring(1));

  // Check that all negative files don't exist
  for (const file of negativeFiles) {
    if (existsSync(join(projectPath, file))) {
      return false;
    }
  }

  // Check that at least one positive file exists
  if (positiveFiles.length === 0) {
    // If there are only negative files and they all don't exist, return true
    return negativeFiles.length > 0;
  }

  for (const file of positiveFiles) {
    if (existsSync(join(projectPath, file))) {
      return true;
    }
  }

  return false;
}

export async function detectLanguages(
  projectPath: string
): Promise<Language[]> {
  const languages: Language[] = [];

  for (const [language, files] of Object.entries(LANGUAGE_FILES)) {
    if (checkFilesMatch(projectPath, files)) {
      languages.push(language as Language);
    }
  }

  return languages;
}

export async function detectPackageManagers(
  projectPath: string
): Promise<PackageManager[]> {
  const packageManagers: PackageManager[] = [];

  for (const [manager, files] of Object.entries(PACKAGE_MANAGER_FILES)) {
    if (checkFilesMatch(projectPath, files)) {
      packageManagers.push(manager as PackageManager);
    }
  }

  return packageManagers;
}

export async function detectTaskManagers(
  projectPath: string
): Promise<TaskManager[]> {
  const taskManagers: TaskManager[] = [];

  for (const [manager, files] of Object.entries(TASK_MANAGER_FILES)) {
    if (checkFilesMatch(projectPath, files)) {
      taskManagers.push(manager as TaskManager);
    }
  }

  return taskManagers;
}

export async function detectEnvironment(
  projectPath: string
): Promise<Environment> {
  const [languages, packageManagers, taskManagers] = await Promise.all([
    detectLanguages(projectPath),
    detectPackageManagers(projectPath),
    detectTaskManagers(projectPath),
  ]);

  return {
    languages,
    packageManagers,
    taskManagers,
  };
}
