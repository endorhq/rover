/**
 * Utility for parsing step agent strings in the format "step:tool:model" or "step:tool"
 */

import { AI_AGENT } from 'rover-core';

export interface ParsedStepAgent {
  stepId: string;
  tool: string;
  model?: string;
}

/**
 * Parse a step agent string in the format "step:tool" or "step:tool:model"
 * @param input - The input string to parse (e.g., "implement:claude:opus" or "context:gemini")
 * @returns Parsed step agent configuration
 * @throws Error if the format is invalid
 */
export function parseStepAgentString(input: string): ParsedStepAgent {
  const parts = input.split(':');

  if (parts.length < 2) {
    throw new Error(
      `Invalid step-agent format: "${input}". Expected "step:tool" or "step:tool:model"`
    );
  }

  const stepId = parts[0].trim();
  const tool = parts[1].trim();
  const model = parts.length > 2 ? parts.slice(2).join(':').trim() : undefined;

  if (!stepId) {
    throw new Error(
      `Invalid step-agent format: "${input}". Step ID cannot be empty`
    );
  }

  if (!tool) {
    throw new Error(
      `Invalid step-agent format: "${input}". Tool cannot be empty`
    );
  }

  // Validate tool is a known AI agent
  const normalizedTool = tool.toLowerCase();
  const validAgents = Object.values(AI_AGENT).map(a => a.toLowerCase());

  if (!validAgents.includes(normalizedTool)) {
    throw new Error(
      `Invalid tool "${tool}" in step-agent "${input}". Valid tools: ${Object.values(AI_AGENT).join(', ')}`
    );
  }

  return {
    stepId,
    tool: normalizedTool,
    model: model || undefined,
  };
}

/**
 * Validate that all step IDs in the parsed step agents are valid for the given workflow
 * @param stepAgents - Array of parsed step agents
 * @param validStepIds - Array of valid step IDs for the workflow
 * @throws Error if any step ID is invalid
 */
export function validateStepIds(
  stepAgents: ParsedStepAgent[],
  validStepIds: string[]
): void {
  for (const sa of stepAgents) {
    if (!validStepIds.includes(sa.stepId)) {
      throw new Error(
        `Invalid step ID "${sa.stepId}". Valid steps for this workflow: ${validStepIds.join(', ')}`
      );
    }
  }
}

/**
 * Convert an array of parsed step agents to a record for storage
 * @param stepAgents - Array of parsed step agents
 * @returns Record mapping step ID to tool/model config
 */
export function stepAgentsToRecord(
  stepAgents: ParsedStepAgent[]
): Record<string, { tool?: string; model?: string }> {
  const record: Record<string, { tool?: string; model?: string }> = {};

  for (const sa of stepAgents) {
    record[sa.stepId] = {
      tool: sa.tool,
      model: sa.model,
    };
  }

  return record;
}
