/**
 * Custom error classes for agent workflow execution
 */

/**
 * Base error class for all agent-related errors
 */
export abstract class AgentError extends Error {
  abstract readonly code: string;
  abstract readonly isRetryable: boolean;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Authentication error - agent requires authentication or token is invalid
 */
export class AuthenticationError extends AgentError {
  readonly code = 'AUTHENTICATION_ERROR';
  readonly isRetryable = false;

  constructor(
    message: string,
    public readonly tool?: string
  ) {
    super(message);
  }
}

/**
 * Rate limit error - API rate limits exceeded
 */
export class RateLimitError extends AgentError {
  readonly code = 'RATE_LIMIT_ERROR';
  readonly isRetryable = true;

  constructor(
    message: string,
    public readonly retryAfter?: number,
    public readonly tool?: string
  ) {
    super(message);
  }
}

/**
 * Tool execution error - invalid parameters or tool-specific errors
 */
export class ToolExecutionError extends AgentError {
  readonly code = 'TOOL_EXECUTION_ERROR';
  readonly isRetryable = false;

  constructor(
    message: string,
    public readonly tool?: string,
    public readonly details?: any
  ) {
    super(message);
  }
}

/**
 * Timeout error - operation exceeded time limit
 */
export class TimeoutError extends AgentError {
  readonly code = 'TIMEOUT_ERROR';
  readonly isRetryable = true;

  constructor(
    message: string,
    public readonly timeoutMs?: number
  ) {
    super(message);
  }
}

/**
 * Network error - connection issues
 */
export class NetworkError extends AgentError {
  readonly code = 'NETWORK_ERROR';
  readonly isRetryable = true;

  constructor(
    message: string,
    public readonly originalError?: Error
  ) {
    super(message);
  }
}

/**
 * Invalid model error - specified model is not available
 */
export class InvalidModelError extends AgentError {
  readonly code = 'INVALID_MODEL_ERROR';
  readonly isRetryable = false;

  constructor(
    message: string,
    public readonly model?: string,
    public readonly tool?: string
  ) {
    super(message);
  }
}

/**
 * Permission error - insufficient permissions
 */
export class PermissionError extends AgentError {
  readonly code = 'PERMISSION_ERROR';
  readonly isRetryable = false;

  constructor(
    message: string,
    public readonly resource?: string
  ) {
    super(message);
  }
}

/**
 * Generic agent error - for unclassified errors
 */
export class GenericAgentError extends AgentError {
  readonly code = 'GENERIC_ERROR';
  readonly isRetryable = false;

  constructor(
    message: string,
    public readonly originalError?: Error | string
  ) {
    super(message);
  }
}

/**
 * Error detection patterns for different tools
 */
interface ErrorPattern {
  pattern: RegExp;
  errorClass: new (message: string, ...args: any[]) => AgentError;
  extractMessage?: (match: RegExpMatchArray, fullText: string) => string;
  extractArgs?: (match: RegExpMatchArray, fullText: string) => any[];
}

/**
 * Common error patterns across different AI tools
 */
const ERROR_PATTERNS: ErrorPattern[] = [
  // Authentication errors
  {
    pattern:
      /authentication[_\s]error|invalid[_\s]bearer[_\s]token|401|unauthorized/i,
    errorClass: AuthenticationError,
    extractMessage: (match, fullText) => {
      const jsonMatch = fullText.match(/"message":"([^"]+)"/);
      return jsonMatch ? jsonMatch[1] : 'Authentication failed';
    },
  },
  {
    pattern:
      /Please visit the following URL to authorize|Enter the authorization code/i,
    errorClass: AuthenticationError,
    extractMessage: () =>
      'Authentication required - tool is waiting for authorization',
  },

  // Rate limit errors
  {
    pattern: /rate[_\s]limit|too[_\s]many[_\s]requests|429/i,
    errorClass: RateLimitError,
    extractMessage: (match, fullText) => {
      const jsonMatch = fullText.match(/"message":"([^"]+)"/);
      return jsonMatch ? jsonMatch[1] : 'Rate limit exceeded';
    },
  },

  // Tool execution errors
  {
    pattern:
      /FatalToolExecutionError|invalid_tool_params|File path must be absolute/i,
    errorClass: ToolExecutionError,
    extractMessage: (match, fullText) => {
      const jsonMatch = fullText.match(/"message":"([^"]+)"/);
      return jsonMatch ? jsonMatch[1] : 'Tool execution failed';
    },
  },

  // Invalid model errors
  {
    pattern: /model[_\s]not[_\s]found|invalid[_\s]model|unsupported[_\s]model/i,
    errorClass: InvalidModelError,
    extractMessage: (match, fullText) => {
      const jsonMatch = fullText.match(/"message":"([^"]+)"/);
      return jsonMatch ? jsonMatch[1] : 'Invalid or unsupported model';
    },
  },

  // Network errors
  {
    pattern:
      /ECONNREFUSED|ETIMEDOUT|ENETUNREACH|network[_\s]error|connection[_\s]failed/i,
    errorClass: NetworkError,
    extractMessage: () => 'Network connection failed',
  },

  // Permission errors
  {
    pattern: /permission[_\s]denied|access[_\s]denied|forbidden|403/i,
    errorClass: PermissionError,
    extractMessage: (match, fullText) => {
      const jsonMatch = fullText.match(/"message":"([^"]+)"/);
      return jsonMatch ? jsonMatch[1] : 'Permission denied';
    },
  },
];

/**
 * Parse error output and classify it into appropriate error type
 */
export function parseAgentError(
  stderr: string,
  stdout: string,
  exitCode: number | null,
  tool?: string
): AgentError {
  const combinedOutput = `${stderr}\n${stdout}`;

  // Check for authentication prompts that indicate the process is waiting for input
  if (isWaitingForAuthentication(stderr)) {
    return new AuthenticationError(
      'Agent requires authentication - process was terminated',
      tool
    );
  }

  // Try to parse JSON errors first
  const jsonError = extractJsonError(combinedOutput);
  if (jsonError) {
    return classifyJsonError(jsonError, tool);
  }

  // Match against known patterns
  for (const errorPattern of ERROR_PATTERNS) {
    const match = combinedOutput.match(errorPattern.pattern);
    if (match) {
      const message = errorPattern.extractMessage
        ? errorPattern.extractMessage(match, combinedOutput)
        : match[0];

      const args = errorPattern.extractArgs
        ? errorPattern.extractArgs(match, combinedOutput)
        : [];

      return new errorPattern.errorClass(message, tool, ...args);
    }
  }

  // Default to generic error
  const errorMessage =
    extractErrorMessage(stderr, stdout) || 'Agent execution failed';
  return new GenericAgentError(errorMessage, combinedOutput);
}

/**
 * Check if the process is waiting for authentication input
 */
export function isWaitingForAuthentication(stderr: string): boolean {
  const authPatterns = [
    /Please visit the following URL to authorize/i,
    /Enter the authorization code:/i,
    /https:\/\/accounts\.google\.com\/o\/oauth2/i,
    /Failed to authenticate.*Retrying/i,
  ];

  return authPatterns.some(pattern => pattern.test(stderr));
}

/**
 * Extract JSON error from output
 */
function extractJsonError(output: string): any {
  // Try to find JSON objects in the output
  const jsonMatches = output.match(/\{[\s\S]*?\}/g);
  if (!jsonMatches) return null;

  for (const jsonStr of jsonMatches) {
    try {
      const parsed = JSON.parse(jsonStr);
      // Check if it looks like an error object
      if (parsed.error || parsed.type === 'error' || parsed.is_error) {
        return parsed;
      }
    } catch {
      // Not valid JSON, continue
    }
  }

  return null;
}

/**
 * Classify a parsed JSON error
 */
function classifyJsonError(jsonError: any, tool?: string): AgentError {
  // Check for specific error types in JSON structure
  const errorInfo = jsonError.error || jsonError;
  const errorType = errorInfo.type?.toLowerCase() || '';
  const errorCode = errorInfo.code?.toLowerCase() || '';
  const message = errorInfo.message || jsonError.result || 'Unknown error';

  if (errorType.includes('authentication') || errorCode.includes('auth')) {
    return new AuthenticationError(message, tool);
  }

  if (errorType.includes('rate') || errorCode.includes('rate')) {
    return new RateLimitError(message, undefined, tool);
  }

  if (errorType.includes('tool') || errorCode.includes('tool')) {
    return new ToolExecutionError(message, tool, errorInfo);
  }

  if (errorType.includes('model') || errorCode.includes('model')) {
    return new InvalidModelError(message, undefined, tool);
  }

  if (errorType.includes('permission') || errorCode.includes('permission')) {
    return new PermissionError(message);
  }

  return new GenericAgentError(message, jsonError);
}

/**
 * Extract a meaningful error message from output
 */
function extractErrorMessage(stderr: string, stdout: string): string | null {
  // Try to find error messages in common formats
  const patterns = [
    /"message":"([^"]+)"/,
    /Error:\s*(.+)/i,
    /Failed:\s*(.+)/i,
    /✗\s*(.+)/,
  ];

  const combinedOutput = `${stderr}\n${stdout}`;

  for (const pattern of patterns) {
    const match = combinedOutput.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  // Return first non-empty line from stderr as fallback
  const stderrLines = stderr.split('\n').filter(line => line.trim());
  if (stderrLines.length > 0) {
    return stderrLines[0].trim();
  }

  return null;
}
