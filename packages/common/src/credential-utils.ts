export function requiredClaudeCredentials(): boolean {
  return !requiredBedrockCredentials() && !requiredVertexAiCredentials();
}

export function requiredBedrockCredentials(): boolean {
  return process.env.CLAUDE_CODE_USE_BEDROCK === '1';
}

export function requiredVertexAiCredentials(): boolean {
  return process.env.CLAUDE_CODE_USE_VERTEX === '1';
}
