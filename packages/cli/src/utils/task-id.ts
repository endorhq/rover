import { existsSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Get the next auto-increment task ID
 */
export const getNextTaskId = (): number => {
    const endorPath = join(process.cwd(), '.rover');
    const counterPath = join(endorPath, 'task-counter.json');
    
    let counter = { nextId: 1 };
    
    // Read existing counter if it exists
    if (existsSync(counterPath)) {
        try {
            const counterData = readFileSync(counterPath, 'utf8');
            counter = JSON.parse(counterData);
        } catch (error) {
            // If counter file is corrupted, start from 1
            counter = { nextId: 1 };
        }
    }
    
    // Get current ID and increment for next time
    const currentId = counter.nextId;
    counter.nextId++;
    
    // Save updated counter
    try {
        writeFileSync(counterPath, JSON.stringify(counter, null, 2));
    } catch (error) {
        console.error('Warning: Could not save task counter:', error);
    }
    
    return currentId;
};

/**
 * Get all existing task IDs as numbers
 */
export const getExistingTaskIds = (): number[] => {
    const endorPath = join(process.cwd(), '.rover');
    const tasksPath = join(endorPath, 'tasks');
    
    if (!existsSync(tasksPath)) {
        return [];
    }
    
    try {
        const taskDirs = readdirSync(tasksPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name)
            .map(name => parseInt(name, 10))
            .filter(id => !isNaN(id))
            .sort((a, b) => a - b);
            
        return taskDirs;
    } catch (error) {
        return [];
    }
};