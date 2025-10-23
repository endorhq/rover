// Other templates
import expandIterationPrompt from './expand-iteration-instructions.md';
import expandTaskPrompt from './expand-task.md';
import generateCommitPrompt from './generate-commit-message.md';
import resolveMergePrompt from './resolve-merge-conflicts.md';
import extractGithubInputsPrompt from './extract-github-inputs.md';
import type { WorkflowInput } from 'rover-schemas';

enum PROMPT_ID {
  // Others
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

/**
 * PromptBuilder provides a centralized system for generating prompts for different AI agents.
 *
 * This library serves two main purposes:
 * 1. Generate structured prompts for task iteration workflows (context, plan, implement, etc.)
 * 2. Provide standardized prompts for common AI operations (task expansion, commit messages, etc.)
 *
 * The prompts are designed to be agent-agnostic, with some customization possible through
 * the agent parameter. All prompt methods return strings that should be sent to AI agents
 * for processing. For JSON responses, use the parseJsonResponse utility to handle the results.
 *
 * @example
 * ```typescript
 * const builder = new PromptBuilder('claude');
 * const taskPrompt = builder.expandTaskPrompt('add user authentication');
 * const result = await aiAgent.invoke(taskPrompt, true);
 * const parsed = parseJsonResponse<IPromptTask>(result);
 * ```
 */
export class PromptBuilder {
  /**
   * Create a new PromptBuilder instance
   * @param agent - The AI agent identifier (e.g., 'claude', 'gemini')
   */
  constructor(public agent: string = 'claude') {}

  /**
   * Load a prompt template from a markdown file and replace placeholders
   * @param templateName - The name of the template file (without .md extension)
   * @param replacements - Object containing placeholder replacements
   * @returns The processed prompt string
   */
  private loadTemplate(
    templateId: PROMPT_ID,
    replacements: Record<string, string>
  ): string {
    let template = `${PROMPT_CONTENT[templateId]}`;

    // Replace all placeholders with their values
    for (const [key, value] of Object.entries(replacements)) {
      const placeholder = `%${key}%`;
      template = template.replace(new RegExp(placeholder, 'g'), value);
    }

    return '\n' + template.trim() + '\n';
  }

  /**
   * Generate a prompt for expanding a brief task description into a structured task
   * with title and description. This method returns a prompt string that should be
   * sent to an AI agent for processing.
   *
   * @param briefDescription - A brief description of the task to be expanded
   * @returns A formatted prompt string for AI processing
   *
   * @example
   * const builder = new PromptBuilder('claude');
   * const prompt = builder.expandTaskPrompt('add dark mode');
   * // Use with AI agent: const result = await aiAgent.invoke(prompt, true);
   * // Then parse: const parsed = parseJsonResponse<IPromptTask>(result);
   */
  expandTaskPrompt(briefDescription: string): string {
    return this.loadTemplate(PROMPT_ID.ExpandTask, {
      briefDescription,
    });
  }

  /**
   * Generate a prompt for expanding iteration instructions based on previous work context.
   * This method helps create focused iteration tasks that build upon previous implementations.
   *
   * @param instructions - New user instructions for this iteration
   * @param previousPlan - Optional previous plan from earlier iterations
   * @param previousChanges - Optional description of changes made in previous iterations
   * @returns A formatted prompt string for AI processing that incorporates context
   *
   * @example
   * const builder = new PromptBuilder('gemini');
   * const prompt = builder.expandIterationInstructionsPrompt(
   *   'add error handling',
   *   'Previous plan: Implement user login',
   *   'Previous changes: Added basic login form'
   * );
   */
  expandIterationInstructionsPrompt(
    instructions: string,
    previousPlan?: string,
    previousChanges?: string
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

    return this.loadTemplate(PROMPT_ID.ExpandIteration, {
      contextSection,
      instructions,
    });
  }

  /**
   * Generate a prompt for creating git commit messages based on task information
   * and recent commit history. The generated message will follow conventional
   * commit formats and match the project's commit style.
   *
   * @param taskTitle - The title of the completed task
   * @param taskDescription - Detailed description of the task
   * @param recentCommits - Array of recent commit messages for style consistency
   * @param summaries - Array of iteration summaries describing work completed
   * @returns A formatted prompt string for generating commit messages
   *
   * @example
   * const builder = new PromptBuilder();
   * const prompt = builder.generateCommitMessagePrompt(
   *   'Add user authentication',
   *   'Implement login and signup functionality',
   *   ['feat: add user profile page', 'fix: resolve validation bug'],
   *   ['Iteration 1: Basic auth setup']
   * );
   */
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

  /**
   * Generate a prompt for AI-powered merge conflict resolution. This creates
   * detailed instructions for resolving Git merge conflicts by analyzing
   * conflict markers and recent commit context.
   *
   * @param filePath - Path to the file containing merge conflicts
   * @param diffContext - Recent commit history or diff context for better understanding
   * @param conflictedContent - The full content of the file with conflict markers
   * @returns A formatted prompt string for resolving merge conflicts
   *
   * @example
   * const builder = new PromptBuilder();
   * const prompt = builder.resolveMergeConflictsPrompt(
   *   'src/components/Header.tsx',
   *   'Recent commits: feat: update header, fix: resolve styling',
   *   '<<<<<<< HEAD\nconst title = "Old Title"\n=======\nconst title = "New Title"\n>>>>>>> feature-branch'
   * );
   */
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

  /**
   * Generate a prompt for extracting workflow input values from a GitHub issue description.
   * This method helps parse and extract structured data from unstructured issue text based
   * on the workflow's required inputs.
   *
   * @param issueDescription - The full GitHub issue description text
   * @param inputs - Array of workflow input definitions that need to be extracted
   * @returns A formatted prompt string for AI processing
   *
   * @example
   * const builder = new PromptBuilder();
   * const prompt = builder.extractGithubInputsPrompt(
   *   'We need to add authentication to the API with JWT tokens',
   *   [
   *     { name: 'feature', description: 'Feature to implement', type: 'string', required: true },
   *     { name: 'urgent', description: 'Is this urgent?', type: 'boolean', required: true }
   *   ]
   * );
   */
  extractGithubInputsPrompt(
    issueDescription: string,
    inputs: WorkflowInput[]
  ): string {
    // Format inputs metadata as a readable list
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
