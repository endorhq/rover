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
    public readonly details?: unknown
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
  /** Build the correct error instance. Constructor signatures differ per class,
   *  so each pattern must place `tool` in the right position. */
  createError: (message: string, tool?: string) => AgentError;
}

/**
 * Common error patterns across different AI tools
 */
const ERROR_PATTERNS: ErrorPattern[] = [
  // Credit/usage limit errors (CLI-level messages)
  {
    pattern: /hit your limit|usage limit|plan limit/i,
    errorClass: RateLimitError,
    extractMessage: (match, fullText) => {
      const lineMatch = fullText.match(/.*hit your limit.*/i);
      return lineMatch ? lineMatch[0].trim() : 'Usage limit reached';
    },
    createError: (message, tool) =>
      new RateLimitError(message, undefined, tool),
  },

  // Authentication errors
  {
    pattern:
      /authentication[_\s]error|invalid[_\s]bearer[_\s]token|401|unauthorized/i,
    errorClass: AuthenticationError,
    extractMessage: (match, fullText) => {
      const jsonMatch = fullText.match(/"message":"([^"]+)"/);
      return jsonMatch ? jsonMatch[1] : 'Authentication failed';
    },
    createError: (message, tool) => new AuthenticationError(message, tool),
  },
  {
    pattern:
      /Please visit the following URL to authorize|Enter the authorization code/i,
    errorClass: AuthenticationError,
    extractMessage: () =>
      'Authentication required - tool is waiting for authorization',
    createError: (message, tool) => new AuthenticationError(message, tool),
  },

  // Rate limit errors
  {
    pattern: /rate[_\s]limit|too[_\s]many[_\s]requests|\b429\b/i,
    errorClass: RateLimitError,
    extractMessage: (match, fullText) => {
      const jsonMatch = fullText.match(/"message":"([^"]+)"/);
      return jsonMatch ? jsonMatch[1] : 'Rate limit exceeded';
    },
    createError: (message, tool) =>
      new RateLimitError(message, undefined, tool),
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
    createError: (message, tool) => new ToolExecutionError(message, tool),
  },

  // Invalid model errors
  {
    pattern: /model[_\s]not[_\s]found|invalid[_\s]model|unsupported[_\s]model/i,
    errorClass: InvalidModelError,
    extractMessage: (match, fullText) => {
      const jsonMatch = fullText.match(/"message":"([^"]+)"/);
      return jsonMatch ? jsonMatch[1] : 'Invalid or unsupported model';
    },
    createError: (message, tool) =>
      new InvalidModelError(message, undefined, tool),
  },

  // Network errors
  {
    pattern:
      /ECONNREFUSED|ETIMEDOUT|ENETUNREACH|network[_\s]error|connection[_\s]failed/i,
    errorClass: NetworkError,
    extractMessage: () => 'Network connection failed',
    createError: message => new NetworkError(message),
  },

  // Permission errors
  {
    pattern: /permission[_\s]denied|access[_\s]denied|forbidden|\b403\b/i,
    errorClass: PermissionError,
    extractMessage: (match, fullText) => {
      const jsonMatch = fullText.match(/"message":"([^"]+)"/);
      return jsonMatch ? jsonMatch[1] : 'Permission denied';
    },
    createError: message => new PermissionError(message),
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
  const jsonStderrError = extractJsonError(stderr);
  if (jsonStderrError) {
    return classifyJsonError(jsonStderrError, tool);
  }

  const jsonStdoutError = extractJsonError(stdout);
  if (jsonStdoutError) {
    return classifyJsonError(jsonStdoutError, tool);
  }

  // Match against known patterns
  for (const errorPattern of ERROR_PATTERNS) {
    const match = combinedOutput.match(errorPattern.pattern);
    if (match) {
      const message = errorPattern.extractMessage
        ? errorPattern.extractMessage(match, combinedOutput)
        : match[0];

      return errorPattern.createError(message, tool);
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
export function isWaitingForAuthentication(output: string): boolean {
  const authPatterns = [
    /Please visit the following URL to authorize/i,
    /Enter the authorization code:/i,
    /https:\/\/accounts\.google\.com\/o\/oauth2/i,
    /Failed to authenticate.*Retrying/i,
  ];

  return authPatterns.some(pattern => pattern.test(output));
}

/**
 * Extract JSON error from output
 */
function extractJsonError(output: string): any {
  // Limit scan to last 8 KB to avoid slow scans on huge outputs
  const scanLimit = 8192;
  const text =
    output.length > scanLimit
      ? output.slice(output.length - scanLimit)
      : output;

  // Scan for JSON objects by tracking brace depth, which correctly
  // handles nested objects unlike a greedy/non-greedy regex approach.
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      if (text[j] === '{') depth++;
      if (text[j] === '}') depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.substring(i, j + 1));
          if (parsed.error || parsed.type === 'error' || parsed.is_error) {
            return parsed;
          }
        } catch {
          // Not valid JSON at this boundary
        }
        break;
      }
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

  if (
    errorType.includes('authentication') ||
    errorCode.includes('auth') ||
    message.toLowerCase().includes('invalid api key')
  ) {
    // Check if this is actually a credit/billing error misclassified as auth.
    // Require conjunction of keywords to avoid false positives (e.g. "billing
    // is not configured" should stay as AuthenticationError).
    if (
      /credit.*(limit|exhaust|balance|insufficien)/i.test(message) ||
      /billing.*(limit|error|issue|problem)/i.test(message) ||
      /quota.*(exceed|exhaust|limit|reached)/i.test(message) ||
      /balance.*(insufficien|low|zero|negative|empty)/i.test(message) ||
      /limit.*(reach|exceed|exhaust)/i.test(message)
    ) {
      return new RateLimitError(message, undefined, tool);
    }
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
