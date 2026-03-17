import { ACPAgentBase } from './acp-agent-base.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// Environment variables reference for OpenCode:
// - https://opencode.ai/docs/providers/#environment-variables-quick-start
const OPENCODE_ENV_VARS = [
  // General configuration
  'NO_COLOR',
  'DEBUG',

  // AWS/Amazon Bedrock
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_PROFILE',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_ROLE_ARN',
  'AWS_REGION',

  // Azure
  'AZURE_RESOURCE_NAME',
  'AZURE_COGNITIVE_SERVICES_RESOURCE_NAME',

  // Cloudflare
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_GATEWAY_ID',
  'CLOUDFLARE_API_TOKEN',

  // Google Cloud/Vertex AI
  'GOOGLE_CLOUD_PROJECT',
  'VERTEX_LOCATION',
  'GOOGLE_APPLICATION_CREDENTIALS',

  // GitLab
  'GITLAB_TOKEN',
  'GITLAB_INSTANCE_URL',
  'GITLAB_AI_GATEWAY_URL',
  'GITLAB_OAUTH_CLIENT_ID',

  // SAP AI Core
  'AICORE_SERVICE_KEY',
  'AICORE_DEPLOYMENT_ID',
  'AICORE_RESOURCE_GROUP',
];

class OpenCodeAI extends ACPAgentBase {
  readonly AGENT_BIN = 'opencode';
  readonly AGENT_NAME = 'opencode';

  getContainerMounts(): string[] {
    const dockerMounts: string[] = [];

    // OpenCode stores config in ~/.config/opencode/ directory
    // See: https://opencode.ai/docs/providers/#config
    const opencodeConfigFolder = join(homedir(), '.config', 'opencode');
    if (existsSync(opencodeConfigFolder)) {
      dockerMounts.push(`-v`, `${opencodeConfigFolder}:/.config/opencode:Z,ro`);
    }

    // OpenCode stores credentials in ~/.local/share/opencode/auth.json
    // See: https://opencode.ai/docs/providers/#credentials
    const opencodeDataFolder = join(homedir(), '.local', 'share', 'opencode');
    if (existsSync(opencodeDataFolder)) {
      dockerMounts.push(
        `-v`,
        `${opencodeDataFolder}:/.local/share/opencode:Z,ro`
      );
    }

    return dockerMounts;
  }

  getEnvironmentVariables(): string[] {
    const envVars: string[] = [];
    const addedKeys = new Set<string>();

    // Common provider prefixes
    const providerPrefixes = [
      'OPENCODE_',
      'ANTHROPIC_',
      'OPENAI_',
      'AZURE_',
      'AWS_',
      'GOOGLE_',
      'VERTEX_',
      'GITLAB_',
      'CLOUDFLARE_',
      'AICORE_',
    ];

    // Look for any provider-prefixed env vars
    for (const key in process.env) {
      if (providerPrefixes.some(prefix => key.startsWith(prefix))) {
        if (!addedKeys.has(key)) {
          envVars.push('-e', key);
          addedKeys.add(key);
        }
      }
    }

    // Add other specific environment variables from OPENCODE_ENV_VARS
    for (const key of OPENCODE_ENV_VARS) {
      if (process.env[key] !== undefined && !addedKeys.has(key)) {
        envVars.push('-e', key);
        addedKeys.add(key);
      }
    }

    return envVars;
  }
}

export default OpenCodeAI;
