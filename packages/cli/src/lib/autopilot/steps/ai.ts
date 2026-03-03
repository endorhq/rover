import { getUserAIAgent, getAIAgentTool } from '../../agents/index.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import {
  loadCustomInstructions,
  formatCustomInstructions,
  formatMaintainers,
} from './custom-instructions.js';

/**
 * Invoke the user's configured AI agent and parse the JSON response.
 *
 * Wraps the 4-line pattern repeated across autopilot steps:
 * ```
 * const agent = getUserAIAgent();
 * const agentTool = getAIAgentTool(agent);
 * const response = await agentTool.invoke(userMessage, { json: true, ... });
 * return parseJsonResponse<T>(response);
 * ```
 */
export async function invokeAI<T>(opts: {
  userMessage: string;
  systemPrompt: string;
  cwd?: string;
  model?: string;
  tools?: string[];
}): Promise<T> {
  const agent = getUserAIAgent();
  const agentTool = getAIAgentTool(agent);
  const response = await agentTool.invoke(opts.userMessage, {
    json: true,
    cwd: opts.cwd,
    model: opts.model,
    systemPrompt: opts.systemPrompt,
    tools: opts.tools,
  });
  return parseJsonResponse<T>(response);
}

/**
 * Append project-level custom instructions and maintainers to a prompt.
 *
 * Centralizes the 2-3 line suffix applied by most AI steps:
 * ```
 * systemPrompt += formatMaintainers(ctx.maintainers);
 * systemPrompt += formatCustomInstructions(loadCustomInstructions(projectPath, stepName));
 * ```
 */
export function appendPromptSuffix(
  prompt: string,
  opts: {
    projectPath: string;
    stepName: string;
    maintainers?: string[];
  }
): string {
  let result = prompt;
  result += formatMaintainers(opts.maintainers);
  result += formatCustomInstructions(
    loadCustomInstructions(opts.projectPath, opts.stepName)
  );
  return result;
}
