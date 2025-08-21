import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Environment } from '../types.js';
import { LANGUAGE, PACKAGE_MANAGER, TASK_MANAGER } from '../lib/config.js';

/**
 * Identify project types based on the given files
 */
const LANGUAGE_FILES = {
    [LANGUAGE.TypeScript]: ['tsconfig.json', 'tsconfig.node.json'],
    [LANGUAGE.Javascript]: ['package.json', '.node-version'],
    [LANGUAGE.PHP]: ['composer.json', 'index.php', 'phpunit.xml'],
    [LANGUAGE.Rust]: ['Cargo.toml'],
    [LANGUAGE.Go]: ['go.mod', 'go.sum'],
    [LANGUAGE.Ruby]: ['.ruby-version', 'Procfile.dev', 'Procfile.test', 'Gemfile', 'config.ru'],
    [LANGUAGE.Python]: ['pyproject.toml', 'uv.lock', 'setup.py', 'setup.cfg']
}

/**
 * Identify package managers from files
 */
const PACKAGE_MANAGER_FILES = {
    [PACKAGE_MANAGER.NPM]: ['package-lock.json'],
    [PACKAGE_MANAGER.PNPM]: ['pnpm-lock.yaml'],
    [PACKAGE_MANAGER.Yarn]: ['yarn.lock'],
    [PACKAGE_MANAGER.Composer]: ['composer.lock'],
    [PACKAGE_MANAGER.Cargo]: ['Cargo.toml', 'Cargo.lock'],
    [PACKAGE_MANAGER.Gomod]: ['go.mod', 'go.sum'],
    [PACKAGE_MANAGER.PIP]: ['pyproject.toml', '!poetry.lock', '!uv.lock'],
    [PACKAGE_MANAGER.Poetry]: ['poetry.lock'],
    [PACKAGE_MANAGER.UV]: ['uv.lock'],
    [PACKAGE_MANAGER.Rubygems]: ['Gemfile', 'Gemfile.lock'],
}

/**
 * Identify task managers from files
 */
const TASK_MANAGER_FILES = {
    [TASK_MANAGER.Just]: ['Jusfile'],
    [TASK_MANAGER.Make]: ['Makefile'],
    [TASK_MANAGER.Task]: ['Taskfile.yml', 'Taskfile.yaml']
}

/**
 * Check if files match the pattern (including negation support)
 * Returns true if ANY positive file exists AND ALL negative files don't exist
 */
function checkFilesMatch(projectPath: string, files: string[]): boolean {
    const positiveFiles = files.filter(f => !f.startsWith('!'));
    const negativeFiles = files.filter(f => f.startsWith('!')).map(f => f.substring(1));

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

export async function detectLanguages(projectPath: string): Promise<LANGUAGE[]> {
    const languages: LANGUAGE[] = [];

    for (const [language, files] of Object.entries(LANGUAGE_FILES)) {
        if (checkFilesMatch(projectPath, files)) {
            languages.push(language as LANGUAGE);
        }
    }

    return languages;
}

export async function detectPackageManagers(projectPath: string): Promise<PACKAGE_MANAGER[]> {
    const packageManagers: PACKAGE_MANAGER[] = [];

    for (const [manager, files] of Object.entries(PACKAGE_MANAGER_FILES)) {
        if (checkFilesMatch(projectPath, files)) {
            packageManagers.push(manager as PACKAGE_MANAGER);
        }
    }

    return packageManagers;
}

export async function detectTaskManagers(projectPath: string): Promise<TASK_MANAGER[]> {
    const taskManagers: TASK_MANAGER[] = [];

    for (const [manager, files] of Object.entries(TASK_MANAGER_FILES)) {
        if (checkFilesMatch(projectPath, files)) {
            taskManagers.push(manager as TASK_MANAGER);
        }
    }

    return taskManagers;
}

export async function detectEnvironment(projectPath: string): Promise<Environment> {
    const [languages, packageManagers, taskManagers] = await Promise.all([
        detectLanguages(projectPath),
        detectPackageManagers(projectPath),
        detectTaskManagers(projectPath)
    ]);

    return {
        languages,
        packageManagers,
        taskManagers
    };
}