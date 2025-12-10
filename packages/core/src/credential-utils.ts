export function requiredClaudeCredentials(): boolean {
  if (requiredBedrockCredentials() || requiredVertexAiCredentials()) {
    return false;
  }

  return true;
}

export function requiredBedrockCredentials(): boolean {
  return (
    process.env.CLAUDE_CODE_USE_BEDROCK === '1' ||
    process.env.CLAUDE_CODE_USE_BEDROCK === 'true' ||
    process.env.CLAUDE_CODE_USE_BEDROCK === 'yes'
  );
}

export function requiredVertexAiCredentials(): boolean {
  return (
    process.env.CLAUDE_CODE_USE_VERTEX === '1' ||
    process.env.CLAUDE_CODE_USE_VERTEX === 'true' ||
    process.env.CLAUDE_CODE_USE_VERTEX === 'yes'
  );
}
