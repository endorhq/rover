import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface IterationFile {
    name: string;
    path: string;
    exists: boolean;
    lastModified?: Date;
    size?: number;
}

export interface TaskIteration {
    number: number;
    status: string;
    startedAt?: string;
    completedAt?: string;
    files: IterationFile[];
    metadata?: any;
}

export class FileSystemHelper {
    private workspaceRoot: string | undefined;

    constructor() {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            this.workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        }
    }

    /**
     * Get all iterations for a task
     */
    async getTaskIterations(taskId: string): Promise<TaskIteration[]> {
        if (!this.workspaceRoot) {
            return [];
        }

        const taskDir = path.join(this.workspaceRoot, '.rover', 'tasks', taskId);
        if (!fs.existsSync(taskDir)) {
            return [];
        }

        const iterations: TaskIteration[] = [];

        try {
            const entries = fs.readdirSync(taskDir, { withFileTypes: true });
            const iterationDirs = entries
                .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name))
                .sort((a, b) => parseInt(a.name) - parseInt(b.name));

            for (const iterationDir of iterationDirs) {
                const iterationPath = path.join(taskDir, iterationDir.name);
                const iterationNumber = parseInt(iterationDir.name);
                
                const iteration = await this.parseIteration(iterationPath, iterationNumber);
                iterations.push(iteration);
            }
        } catch (error) {
            console.warn('Error reading task iterations:', error);
        }

        return iterations;
    }

    /**
     * Parse a single iteration directory
     */
    private async parseIteration(iterationPath: string, iterationNumber: number): Promise<TaskIteration> {
        // Common files to look for
        const commonFiles = [
            'summary.md',
            'validation.md', 
            'planning.md',
            'execution.md',
            'output.md',
            'errors.log'
        ];

        const files: IterationFile[] = [];

        for (const fileName of commonFiles) {
            const filePath = path.join(iterationPath, fileName);
            const exists = fs.existsSync(filePath);
            
            let lastModified: Date | undefined;
            let size: number | undefined;

            if (exists) {
                try {
                    const stats = fs.statSync(filePath);
                    lastModified = stats.mtime;
                    size = stats.size;
                } catch (error) {
                    // Ignore stat errors
                }
            }

            files.push({
                name: fileName,
                path: filePath,
                exists,
                lastModified,
                size
            });
        }

        // Try to load iteration metadata
        let metadata: any = {};
        let status = 'unknown';
        let startedAt: string | undefined;
        let completedAt: string | undefined;

        const metadataPath = path.join(iterationPath, 'metadata.json');
        if (fs.existsSync(metadataPath)) {
            try {
                const metadataContent = fs.readFileSync(metadataPath, 'utf8');
                metadata = JSON.parse(metadataContent);
                status = metadata.status || status;
                startedAt = metadata.startedAt || metadata.started_at;
                completedAt = metadata.completedAt || metadata.completed_at;
            } catch (error) {
                console.warn(`Error parsing metadata for iteration ${iterationNumber}:`, error);
            }
        }

        return {
            number: iterationNumber,
            status,
            startedAt,
            completedAt,
            files,
            metadata
        };
    }

    /**
     * Check if a specific file exists in a task iteration
     */
    fileExists(taskId: string, iterationNumber: number, fileName: string): boolean {
        if (!this.workspaceRoot) {
            return false;
        }

        const filePath = path.join(
            this.workspaceRoot,
            '.rover',
            'tasks',
            taskId,
            iterationNumber.toString(),
            fileName
        );

        return fs.existsSync(filePath);
    }

    /**
     * Get the full path to a task iteration file
     */
    getIterationFilePath(taskId: string, iterationNumber: number, fileName: string): string {
        if (!this.workspaceRoot) {
            throw new Error('No workspace root available');
        }

        return path.join(
            this.workspaceRoot,
            '.rover',
            'tasks',
            taskId,
            iterationNumber.toString(),
            fileName
        );
    }

    /**
     * Get task directory path
     */
    getTaskDirectory(taskId: string): string | undefined {
        if (!this.workspaceRoot) {
            return undefined;
        }

        return path.join(this.workspaceRoot, '.rover', 'tasks', taskId);
    }

    /**
     * Check if task directory exists
     */
    taskExists(taskId: string): boolean {
        const taskDir = this.getTaskDirectory(taskId);
        return taskDir ? fs.existsSync(taskDir) : false;
    }
}