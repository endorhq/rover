import expandIterationPrompt from './expand-iteration-instructions.md';
import expandTaskPrompt from './expand-task.md';
import generateCommitPrompt from './generate-commit-message.md';
import resolveMergePrompt from './resolve-merge-conflicts.md';
import extractGithubInputsPrompt from './extract-github-inputs.md';
import type { WorkflowInput } from 'rover-schemas';

export { default as commitPromptTemplate } from './commit-prompt.md';
export { default as coordinatorPromptTemplate } from './coordinator-prompt.md';
export { default as planPromptTemplate } from './plan-prompt.md';

enum PROMPT_ID {
  ExpandIteration = 'ExpandIteration',
  ExpandTask = 'ExpandTask',
  GenerateCommit = 'GenerateCommit',
  ResolveMerge = 'ResolveMerge',
  ExtractGithubInputs = 'ExtractGithubInputs',
}

const PROMPT_CONTENT: Record<PROMPT_ID, string> = {
  [PROMPT_ID.ExpandIteration]: expandIterationPrompt,
  [PROMPT_ID.ExpandTask]: expandTaskPrompt,
  [PROMPT_ID.GenerateCommit]: generateCommitPrompt,
  [PROMPT_ID.ResolveMerge]: resolveMergePrompt,
  [PROMPT_ID.ExtractGithubInputs]: extractGithubInputsPrompt,
};

/**
 * Interface representing a structured task with title and description.
 * This is the expected format for AI responses when expanding task descriptions
 * or iteration instructions.
 */
export interface IPromptTask {
  /** A concise, action-oriented title for the task (typically max 10-12 words) */
  title: string;
  /** Detailed description explaining what needs to be done, why, and relevant context */
  description: string;
}

export class PromptBuilder {
  constructor(public agent: string = 'claude') {}

  private loadTemplate(
    templateId: PROMPT_ID,
    replacements: Record<string, string>
  ): string {
    let template = `${PROMPT_CONTENT[templateId]}`;

    for (const [key, value] of Object.entries(replacements)) {
      const placeholder = `%${key}%`;
      template = template.replace(new RegExp(placeholder, 'g'), value);
    }

    return '\n' + template.trim() + '\n';
  }

  expandTaskPrompt(briefDescription: string, contextContent?: string): string {
    return this.loadTemplate(PROMPT_ID.ExpandTask, {
      briefDescription,
      contextSection: contextContent
        ? `\nContext Sources:\nThe following context was provided for this task. Use it to create a more accurate and detailed task description:\n\n${contextContent}\n`
        : '',
    });
  }

  expandIterationInstructionsPrompt(
    instructions: string,
    previousPlan?: string,
    previousChanges?: string,
    contextContent?: string
  ): string {
    let contextSection = '';

    if (previousPlan || previousChanges) {
      contextSection += '\nPrevious iteration context:\n';

      if (previousPlan) {
        contextSection += `\nPrevious Plan:\n${previousPlan}\n`;
      }

      if (previousChanges) {
        contextSection += `\nPrevious Changes Made:\n${previousChanges}\n`;
      }
    }

    if (contextContent) {
      contextSection += `\nContext Sources:\nThe following context was provided for this iteration. Use it to create a more accurate and detailed description:\n\n${contextContent}\n`;
    }

    return this.loadTemplate(PROMPT_ID.ExpandIteration, {
      contextSection,
      instructions,
    });
  }

  generateCommitMessagePrompt(
    taskTitle: string,
    taskDescription: string,
    recentCommits: string[],
    summaries: string[]
  ): string {
    let summariesSection = '';
    if (summaries.length > 0) {
      summariesSection = `
${summaries.join('\n')}
-------------------------------------
`;
    }

    const recentCommitsFormatted = recentCommits
      .map((msg, i) => `${i + 1}. ${msg}`)
      .join('\n');

    return this.loadTemplate(PROMPT_ID.GenerateCommit, {
      taskTitle,
      taskDescription,
      summariesSection,
      recentCommitsFormatted,
    });
  }

  resolveMergeConflictsPrompt(
    filePath: string,
    diffContext: string,
    conflictedContent: string
  ): string {
    return this.loadTemplate(PROMPT_ID.ResolveMerge, {
      filePath,
      diffContext,
      conflictedContent,
    });
  }

  extractGithubInputsPrompt(
    issueDescription: string,
    inputs: WorkflowInput[]
  ): string {
    const inputsMetadata = inputs
      .map(input => {
        const label = input.label || input.description;
        return `- ${input.name}: (${input.type}${input.required ? ', required' : ''}) ${label}`;
      })
      .join('\n');

    return this.loadTemplate(PROMPT_ID.ExtractGithubInputs, {
      issueDescription,
      inputsMetadata,
    });
  }
}
