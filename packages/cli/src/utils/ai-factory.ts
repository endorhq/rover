import type { AIProvider } from '../types.js';
import { ClaudeAI } from './ai-claude.js';
import { GeminiAI } from './gemini.js';

export function createAIProvider(agent: string): AIProvider {
    switch (agent.toLowerCase()) {
        case 'claude':
            return new ClaudeAI();
        case 'gemini':
            return new GeminiAI();
        default:
            throw new Error(`Unknown AI agent: ${agent}`);
    }
}