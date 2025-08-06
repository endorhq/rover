export interface RoverTask {
    id: string;
    title: string;
    status: 'initializing' | 'installing' | 'running' | 'completed' | 'failed' | 'unknown';
    progress?: number;
    currentStep: string;
    startedAt: string;
    completedAt?: string;
    error?: string;
}

export interface TaskDetails extends RoverTask {
    description?: string;
    worktreePath?: string;
    branch?: string;
    iterations?: Array<{
        number: number;
        status: string;
        startedAt: string;
        completedAt?: string;
    }>;
}

export interface PushResult {
    success: boolean;
    taskId: number;
    taskTitle: string;
    branchName: string;
    hasChanges: boolean;
    committed: boolean;
    commitMessage?: string;
    pushed: boolean;
    pullRequest?: {
        created: boolean;
        url?: string;
        exists?: boolean;
    };
    error?: string;
}

export interface MergeResult {
    success: boolean;
    taskId: number;
    taskTitle: string;
    branchName: string;
    currentBranch: string;
    hasWorktreeChanges: boolean;
    hasUnmergedCommits: boolean;
    committed: boolean;
    commitMessage?: string;
    merged: boolean;
    conflictsResolved?: boolean;
    cleanedUp?: boolean;
    error?: string;
}

export interface IterateResult {
    success: boolean;
    taskId: number;
    taskTitle: string;
    iterationNumber: number;
    expandedTitle?: string;
    expandedDescription?: string;
    refinements: string;
    worktreePath?: string;
    iterationPath?: string;
    error?: string;
}