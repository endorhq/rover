import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Environment, ProjectType, PackageManager, DevEnvironment, TaskManager } from '../types.js';

export async function detectProjectType(projectPath: string): Promise<ProjectType> {
    const files = {
        typescript: ['tsconfig.json', 'tsconfig.node.json'],
        javascript: ['package.json', '.eslintrc.js', '.eslintrc.json'],
        php: ['composer.json', 'index.php', 'phpunit.xml']
    };

    // Check TypeScript first (it's also JavaScript)
    for (const file of files.typescript) {
        if (existsSync(join(projectPath, file))) {
            return 'typescript';
        }
    }

    // Check JavaScript
    for (const file of files.javascript) {
        if (existsSync(join(projectPath, file))) {
            return 'javascript';
        }
    }

    // Check PHP
    for (const file of files.php) {
        if (existsSync(join(projectPath, file))) {
            return 'php';
        }
    }

    return 'unknown';
}

export async function detectPackageManager(projectPath: string): Promise<PackageManager> {
    const lockFiles = {
        'pnpm-lock.yaml': 'pnpm',
        'yarn.lock': 'yarn',
        'package-lock.json': 'npm',
        'composer.lock': 'composer'
    };

    for (const [file, manager] of Object.entries(lockFiles)) {
        if (existsSync(join(projectPath, file))) {
            return manager as PackageManager;
        }
    }

    // Check for package.json without lock file
    if (existsSync(join(projectPath, 'package.json'))) {
        return 'npm';
    }

    // Check for composer.json without lock file
    if (existsSync(join(projectPath, 'composer.json'))) {
        return 'composer';
    }

    return 'unknown';
}

export async function detectDevEnvironments(projectPath: string): Promise<DevEnvironment[]> {
    const environments: DevEnvironment[] = [];

    if (existsSync(join(projectPath, '.devcontainer', 'devcontainer.json')) || 
        existsSync(join(projectPath, '.devcontainer.json'))) {
        environments.push('devcontainer');
    }

    if (existsSync(join(projectPath, 'docker-compose.yml')) || 
        existsSync(join(projectPath, 'docker-compose.yaml'))) {
        environments.push('docker-compose');
    }

    if (existsSync(join(projectPath, 'Dockerfile'))) {
        environments.push('dockerfile');
    }

    return environments.length > 0 ? environments : ['local'];
}

export async function detectTaskManagers(projectPath: string): Promise<TaskManager[]> {
    const managers: TaskManager[] = [];

    if (existsSync(join(projectPath, 'Taskfile.yml')) || 
        existsSync(join(projectPath, 'Taskfile.yaml'))) {
        managers.push('task');
    }

    if (existsSync(join(projectPath, 'justfile')) || 
        existsSync(join(projectPath, 'Justfile'))) {
        managers.push('just');
    }

    if (existsSync(join(projectPath, 'Makefile')) || 
        existsSync(join(projectPath, 'makefile'))) {
        managers.push('make');
    }

    return managers.length > 0 ? managers : ['none'];
}

export async function detectEnvironment(projectPath: string): Promise<Environment> {
    const [projectType, packageManager, devEnvironments, taskManagers] = await Promise.all([
        detectProjectType(projectPath),
        detectPackageManager(projectPath),
        detectDevEnvironments(projectPath),
        detectTaskManagers(projectPath)
    ]);

    return {
        projectType,
        packageManager,
        devEnvironments,
        taskManagers
    };
}