import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getAllTaskStatuses } from '../status.js';

describe('getAllTaskStatuses', () => {
    let tempDir: string;
    let originalCwd: string;

    beforeEach(() => {
        // Create a temporary directory for each test
        tempDir = join(tmpdir(), `rover-status-test-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`);
        mkdirSync(tempDir, { recursive: true });
        
        // Change to the temp directory for the test
        originalCwd = process.cwd();
        process.chdir(tempDir);
    });

    afterEach(() => {
        // Restore original directory
        process.chdir(originalCwd);
        
        // Clean up temp directory
        try {
            rmSync(tempDir, { recursive: true, force: true });
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    const createTaskStructure = (taskIds: string[], taskData: Record<string, any> = {}) => {
        const roverPath = join(tempDir, '.rover');
        const tasksPath = join(roverPath, 'tasks');
        mkdirSync(tasksPath, { recursive: true });

        taskIds.forEach(taskId => {
            const taskPath = join(tasksPath, taskId);
            mkdirSync(taskPath, { recursive: true });
            
            // Create description.json with task data
            const descriptionPath = join(taskPath, 'description.json');
            writeFileSync(descriptionPath, JSON.stringify(taskData[taskId] || {}, null, 2));
            
            // Create iterations directory with a sample iteration
            const iterationsPath = join(taskPath, 'iterations');
            mkdirSync(iterationsPath, { recursive: true });
            
            const iterationPath = join(iterationsPath, '1');
            mkdirSync(iterationPath, { recursive: true });
            
            // Create a sample status.json
            const statusPath = join(iterationPath, 'status.json');
            writeFileSync(statusPath, JSON.stringify({
                taskId,
                status: 'completed',
                currentStep: 'Task completed',
                startedAt: '2023-01-01T00:00:00.000Z',
                updatedAt: '2023-01-01T01:00:00.000Z',
                completedAt: '2023-01-01T01:00:00.000Z'
            }, null, 2));
        });
    };

    it('should sort task IDs numerically, not alphabetically', () => {
        // Create mixed single and double-digit task IDs
        const taskIds = ['1', '10', '2', '11', '3', '20', '9'];
        createTaskStructure(taskIds);

        // Also create some non-numeric directories and files that should be filtered out
        const roverPath = join(tempDir, '.rover');
        const tasksPath = join(roverPath, 'tasks');
        mkdirSync(join(tasksPath, 'non-numeric'), { recursive: true });
        writeFileSync(join(tasksPath, 'README.md'), 'readme content');

        const results = getAllTaskStatuses();

        // Verify tasks are returned in correct numerical order
        const taskIds_result = results.map(r => r.taskId);
        expect(taskIds_result).toEqual(['1', '2', '3', '9', '10', '11', '20']);

        // Verify non-numeric entries were filtered out
        expect(taskIds_result).not.toContain('non-numeric');
        expect(taskIds_result).not.toContain('README.md');
    });

    it('should handle empty tasks directory', () => {
        // Create empty .rover/tasks directory
        const roverPath = join(tempDir, '.rover');
        const tasksPath = join(roverPath, 'tasks');
        mkdirSync(tasksPath, { recursive: true });

        const results = getAllTaskStatuses();
        expect(results).toEqual([]);
    });

    it('should handle missing tasks directory', () => {
        // Don't create any .rover directory, so it doesn't exist

        const results = getAllTaskStatuses();
        expect(results).toEqual([]);
    });

    it('should sort large numbers correctly', () => {
        // Create task IDs with large numbers
        const taskIds = ['100', '99', '1000', '9', '999'];
        createTaskStructure(taskIds);

        const results = getAllTaskStatuses();
        const taskIds_result = results.map(r => r.taskId);

        expect(taskIds_result).toEqual(['9', '99', '100', '999', '1000']);
    });
});