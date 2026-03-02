// Declare the list of available AI Agents.
export enum AI_AGENT {
  Claude = 'claude',
  Codex = 'codex',
  Copilot = 'copilot',
  Cursor = 'cursor',
  Gemini = 'gemini',
  OpenCode = 'opencode',
  Qwen = 'qwen',
}

/**
 * Agent process exit codes.
 * Shared between the agent (producer) and the CLI sandbox watcher (consumer)
 * to ensure consistent interpretation of container exit status.
 */
export const AGENT_EXIT_CODE = {
  /** Workflow completed successfully. */
  SUCCESS: 0,
  /** Workflow failed with a non-retryable error. */
  FAILED: 1,
  /** Workflow was paused due to a retryable error (e.g. credit exhaustion). */
  PAUSED: 2,
} as const;
