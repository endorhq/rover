import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { getAllTaskStatuses } from '../status.js';

// Mock the fs module
vi.mock('node:fs', () => ({
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn()
}));

describe('getAllTaskStatuses', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should sort task IDs numerically, not alphabetically', () => {
        // Mock the rover tasks directory exists
        vi.mocked(existsSync).mockImplementation((path) => {
            if (path.toString().endsWith('.rover/tasks')) return true;
            return false;
        });

        // Mock directory listing with mixed single and double-digit task IDs
        vi.mocked(readdirSync).mockImplementation((path, options?: any) => {
            if (path.toString().endsWith('.rover/tasks') && options?.withFileTypes) {
                return [
                    { name: '1', isDirectory: () => true },
                    { name: '10', isDirectory: () => true },
                    { name: '2', isDirectory: () => true },
                    { name: '11', isDirectory: () => true },
                    { name: '3', isDirectory: () => true },
                    { name: '20', isDirectory: () => true },
                    { name: '9', isDirectory: () => true },
                    { name: 'non-numeric', isDirectory: () => true }, // Should be filtered out
                    { name: 'README.md', isDirectory: () => false }, // Should be filtered out
                ] as any;
            }
            return [];
        });

        // Mock readFileSync to return empty task data
        vi.mocked(readFileSync).mockReturnValue('{}');

        const results = getAllTaskStatuses();

        // Verify tasks are returned in correct numerical order
        const taskIds = results.map(r => r.taskId);
        expect(taskIds).toEqual(['1', '2', '3', '9', '10', '11', '20']);
        
        // Verify non-numeric entries were filtered out
        expect(taskIds).not.toContain('non-numeric');
        expect(taskIds).not.toContain('README.md');
    });

    it('should handle empty tasks directory', () => {
        // Mock the rover tasks directory exists but is empty
        vi.mocked(existsSync).mockImplementation((path) => {
            if (path.toString().endsWith('.rover/tasks')) return true;
            return false;
        });

        vi.mocked(readdirSync).mockImplementation((path, options?: any) => {
            if (options?.withFileTypes) {
                return [];
            }
            return [];
        });

        const results = getAllTaskStatuses();
        expect(results).toEqual([]);
    });

    it('should handle missing tasks directory', () => {
        // Mock the rover tasks directory doesn't exist
        vi.mocked(existsSync).mockReturnValue(false);

        const results = getAllTaskStatuses();
        expect(results).toEqual([]);
    });

    it('should sort large numbers correctly', () => {
        vi.mocked(existsSync).mockImplementation((path) => {
            if (path.toString().endsWith('.rover/tasks')) return true;
            return false;
        });

        vi.mocked(readdirSync).mockImplementation((path, options?: any) => {
            if (path.toString().endsWith('.rover/tasks') && options?.withFileTypes) {
                return [
                    { name: '100', isDirectory: () => true },
                    { name: '99', isDirectory: () => true },
                    { name: '1000', isDirectory: () => true },
                    { name: '9', isDirectory: () => true },
                    { name: '999', isDirectory: () => true },
                ] as any;
            }
            return [];
        });

        vi.mocked(readFileSync).mockReturnValue('{}');

        const results = getAllTaskStatuses();
        const taskIds = results.map(r => r.taskId);
        
        expect(taskIds).toEqual(['9', '99', '100', '999', '1000']);
    });
});