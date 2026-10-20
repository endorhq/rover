import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';

/** Current MiniMax-compatible text endpoints by region and protocol. */
export const MINIMAX_API_ENDPOINTS = {
  global_en: {
    openai: 'https://api.minimax.io/v1',
    anthropic: 'https://api.minimax.io/anthropic',
  },
  cn_zh: {
    openai: 'https://api.minimaxi.com/v1',
    anthropic: 'https://api.minimaxi.com/anthropic',
  },
} as const;

const MINIMAX_API_ROOTS = {
  global_en: 'https://api.minimax.io',
  cn_zh: 'https://api.minimaxi.com',
} as const;

export const MINIMAX_INSTALL_SPEC =
  'git+https://github.com/MiniMax-AI/Mini-Agent.git';

export interface MiniMaxConfig {
  api_key?: string;
  api_base?: string;
  model?: string;
  provider?: string;
  [key: string]: unknown;
}

interface MiniMaxMcpServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  type?: string;
}

interface MiniMaxMcpConfig {
  mcpServers: Record<string, MiniMaxMcpServer>;
  [key: string]: unknown;
}

export function getMiniMaxConfigPath(
  homeDirectory: string = homedir()
): string {
  return join(homeDirectory, '.mini-agent', 'config', 'config.yaml');
}

export function getMiniMaxMcpConfigPath(
  homeDirectory: string = homedir()
): string {
  return join(homeDirectory, '.mini-agent', 'config', 'mcp.json');
}

/** Convert a documented protocol endpoint to Mini-Agent's root URL format. */
export function normalizeMiniMaxApiBase(apiBase: string): string {
  const normalized = apiBase.trim().replace(/\/+$/, '');

  for (const [region, endpoints] of Object.entries(MINIMAX_API_ENDPOINTS)) {
    if (Object.values(endpoints).some(endpoint => endpoint === normalized)) {
      return MINIMAX_API_ROOTS[region as keyof typeof MINIMAX_API_ROOTS];
    }
  }

  return normalized;
}

function readConfigFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) {
    return fallback;
  }

  const value: unknown = parse(readFileSync(filePath, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid Mini-Agent configuration at ${filePath}`);
  }

  return value as T;
}

function writeConfigFile(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, stringify(value), 'utf8');
}

function writeJsonConfigFile(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** Prepare a copied Mini-Agent config before launching ACP. */
export function prepareMiniMaxConfig(
  model?: string,
  configPath: string = getMiniMaxConfigPath()
): void {
  if (!existsSync(configPath)) {
    return;
  }

  const config = readConfigFile<MiniMaxConfig>(configPath, {});
  let changed = false;

  if (typeof config.api_base === 'string') {
    const normalizedApiBase = normalizeMiniMaxApiBase(config.api_base);
    if (normalizedApiBase !== config.api_base) {
      config.api_base = normalizedApiBase;
      changed = true;
    }
  } else {
    config.api_base = MINIMAX_API_ROOTS.global_en;
    changed = true;
  }

  if (typeof config.provider !== 'string' || config.provider.length === 0) {
    config.provider = 'anthropic';
    changed = true;
  }

  if (typeof config.model !== 'string' || config.model.length === 0) {
    config.model = 'MiniMax-M3.1-Flash';
    changed = true;
  }

  if (model && config.model !== model) {
    config.model = model;
    changed = true;
  }

  if (changed) {
    writeConfigFile(configPath, config);
  }
}

function toKeyValueRecord(
  values: string[],
  separator: string
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const value of values) {
    const index = value.indexOf(separator);
    if (index <= 0) {
      continue;
    }

    const key = value.slice(0, index).trim();
    const content = value.slice(index + separator.length).trim();
    if (key && content) {
      result[key] = content;
    }
  }

  return result;
}

/** Write a standard Mini-Agent MCP configuration entry. */
export function writeMiniMaxMcpConfig(
  configPath: string,
  name: string,
  commandOrUrl: string,
  transport: string,
  envs: string[],
  headers: string[]
): void {
  const config = readConfigFile<MiniMaxMcpConfig>(configPath, {
    mcpServers: {},
  });

  if (!config.mcpServers || typeof config.mcpServers !== 'object') {
    config.mcpServers = {};
  }

  const server: MiniMaxMcpServer = {};
  if (transport === 'stdio') {
    const parts = commandOrUrl.trim().split(/\s+/).filter(Boolean);
    server.command = parts.shift() || commandOrUrl;
    server.args = parts;

    const environment = toKeyValueRecord(envs, '=');
    if (Object.keys(environment).length > 0) {
      server.env = environment;
    }
  } else {
    server.type = transport;
    server.url = commandOrUrl;

    const headerValues = toKeyValueRecord(headers, ':');
    if (Object.keys(headerValues).length > 0) {
      server.headers = headerValues;
    }
  }

  config.mcpServers[name] = server;
  writeJsonConfigFile(configPath, config);
}
