import ClaudeAI from './claude.js';
import GeminiAI from './gemini.js';

export interface AIAgentTool {
    // Invoke the CLI tool using the SDK / direct mode with the given prompt
    invoke(prompt: string, json: boolean): Promise<string>;
}

export class MissingAIAgentError extends Error {
    constructor(agent: string) {
        super(`The agent "${agent}" is missing in the system or it's not properly configured.`);
        this.name = 'MissingAIAgentError';
    }
}

export class InvokeAIAgentError extends Error {
    constructor(agent: string, error: unknown) {
        super(`Failed to invoke "${agent}" due to: ${error}`);
        this.name = 'InvokeAIAgentError';
    }
}

export function getAIAgentTool(agent: string): AIAgentTool {
    switch (agent.toLowerCase()) {
        case 'claude':
            return new ClaudeAI();
        case 'gemini':
            return new GeminiAI();
        default:
            throw new Error(`Unknown AI agent: ${agent}`);
    }
}