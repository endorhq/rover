/**
 * Workflow context injection utilities
 * Provides functionality to inject pre-context steps into workflows dynamically
 */
import type { WorkflowAgentStep } from './workflow/types.js';

/**
 * Data structure for previous iteration information
 */
export interface PreviousIteration {
  number: number;
  title?: string;
  description?: string;
  plan?: string;
  changes?: string;
}

/**
 * Context data for building pre-context steps
 */
export interface PreContextData {
  /** The task ID */
  taskId: string;
  /** Initial task information */
  initialTask: {
    title: string;
    description: string;
  };
  /** Previous iterations (if any) */
  previousIterations?: PreviousIteration[];
  /** Current (last) iteration being executed */
  currentIteration?: PreviousIteration;
}

/**
 * Build a pre-context step that can be injected into workflows
 * This step provides context about the task and previous iterations
 *
 * @param data - Context data including task info and previous iterations
 * @returns A WorkflowAgentStep that can be injected
 */
export function buildPreContextStep(data: PreContextData): WorkflowAgentStep {
  const { taskId, initialTask, previousIterations, currentIteration } = data;

  // Build the iterations section if we have previous iterations
  let iterationsSection = '';
  if (previousIterations && previousIterations.length > 0) {
    iterationsSection = '\n\n## Previous Iterations\n\n';
    iterationsSection += previousIterations
      .map(iter => {
        let section = `### Iteration ${iter.number}\n\n`;

        if (iter.title) {
          section += `**Title:** ${iter.title}\n\n`;
        }

        if (iter.description) {
          section += `**Description:** ${iter.description}\n\n`;
        }

        if (iter.plan) {
          section += '**Plan:**\n```\n' + iter.plan + '\n```\n\n';
        }

        if (iter.changes) {
          section += '**Changes:**\n```\n' + iter.changes + '\n```\n\n';
        }

        return section;
      })
      .join('\n');
  }

  // Build the current iteration section
  let currentIterationSection = '';
  if (currentIteration) {
    currentIterationSection = `\n\n## Current Iteration (Iteration ${currentIteration.number})

**This is the current iteration you are working on.**

`;

    if (currentIteration.title) {
      currentIterationSection += `**Title:** ${currentIteration.title}\n\n`;
    }

    if (currentIteration.description) {
      currentIterationSection += `**Description:** ${currentIteration.description}\n\n`;
    }

    if (currentIteration.plan) {
      currentIterationSection +=
        '**Plan:**\n```\n' + currentIteration.plan + '\n```\n\n';
    }

    if (currentIteration.changes) {
      currentIterationSection +=
        '**Changes from previous iteration:**\n```\n' +
        currentIteration.changes +
        '\n```\n';
    }
  }

  // Build the prompt with all context information
  const prompt = `You are receiving contextual information about this task execution.
This information is provided to help you understand the task history and previous work.

## Task Information

**Task ID:** ${taskId}

**Initial Task:**
- **Title:** ${initialTask.title}
- **Description:** ${initialTask.description}
${iterationsSection}${currentIterationSection}

## Your Role

This context is provided for your awareness.`;

  // Create the pre-context step
  const step: WorkflowAgentStep = {
    id: '__pre_context__',
    type: 'agent',
    name: 'Pre-Context Preparation',
    prompt,
    outputs: [
      {
        name: 'context_acknowledged',
        description: 'Acknowledgment that context was received and understood',
        type: 'string',
      },
    ],
  };

  return step;
}

/**
 * Check if a step is a pre-context step (injected by the system)
 * @param stepId - The step ID to check
 * @returns true if this is a system-injected pre-context step
 */
export function isPreContextStep(stepId: string): boolean {
  return stepId === '__pre_context__';
}
