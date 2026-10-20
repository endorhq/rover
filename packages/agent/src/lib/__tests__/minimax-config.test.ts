import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { MiniMaxAgent } from '../agents/minimax.js';
import {
  getMiniMaxConfigPath,
  MINIMAX_API_ENDPOINTS,
  normalizeMiniMaxApiBase,
  prepareMiniMaxConfig,
  writeMiniMaxMcpConfig,
} from '../agents/minimax-config.js';

describe('MiniMax configuration', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'rover-minimax-test-'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testDir, { recursive: true, force: true });
  });

  it.each([undefined, ''])('defaults an unset model (%s) to Flash', model => {
    const configPath = join(testDir, 'config.yaml');
    writeFileSync(configPath, stringify({ api_key: 'test-key', model }));

    prepareMiniMaxConfig(undefined, configPath);

    expect(parse(readFileSync(configPath, 'utf8'))).toEqual({
      api_key: 'test-key',
      api_base: 'https://api.minimax.io',
      provider: 'anthropic',
      model: 'MiniMax-M3.1-Flash',
    });
  });

  it.each([
    'MiniMax-M3.1-Flash',
    'MiniMax-M3',
    'MiniMax-M2.7',
    'custom-model',
  ])('preserves the saved model %s and unrelated configuration', model => {
    const configPath = join(testDir, 'config.yaml');
    const config = {
      api_key: 'test-key',
      api_base: 'https://gateway.example.test/custom/v1',
      provider: 'openai',
      model,
      tools: { enable_mcp: true, mcp_config_path: 'custom-mcp.json' },
      max_steps: 25,
    };
    const original = stringify(config);
    writeFileSync(configPath, original);

    prepareMiniMaxConfig(undefined, configPath);

    expect(readFileSync(configPath, 'utf8')).toBe(original);
  });

  for (const endpoints of Object.values(MINIMAX_API_ENDPOINTS)) {
    for (const [provider, apiBase] of Object.entries(endpoints)) {
      it(`defaults to Flash with ${apiBase} without changing protocol`, () => {
        const configPath = join(testDir, 'config.yaml');
        writeFileSync(
          configPath,
          stringify({ api_key: 'test-key', api_base: apiBase, provider })
        );

        prepareMiniMaxConfig(undefined, configPath);

        expect(parse(readFileSync(configPath, 'utf8'))).toEqual({
          api_key: 'test-key',
          api_base: new URL(apiBase).origin,
          provider,
          model: 'MiniMax-M3.1-Flash',
        });
      });
    }
  }

  it.each([
    'MiniMax-M3.1-Flash',
    'MiniMax-M3',
    'MiniMax-M2.7',
    'custom-model',
  ])('applies explicit model %s to ACP and interactive launches', model => {
    vi.stubEnv('HOME', testDir);
    const configPath = getMiniMaxConfigPath(testDir);
    mkdirSync(join(testDir, '.mini-agent', 'config'), { recursive: true });
    const original = stringify({ api_key: 'test-key', model: 'saved-model' });
    const agent = new MiniMaxAgent('latest', model);
    writeFileSync(configPath, original);

    expect(agent.toolArguments()).toEqual([]);
    expect(parse(readFileSync(configPath, 'utf8')).model).toBe(model);

    writeFileSync(configPath, original);
    expect(agent.toolInteractiveArguments('context', 'prompt')).toEqual([
      '--workspace',
      process.cwd(),
      'context\n\nprompt',
    ]);
    expect(parse(readFileSync(configPath, 'utf8')).model).toBe(model);
  });

  it('normalizes each documented regional endpoint to its API root', () => {
    expect(
      normalizeMiniMaxApiBase(MINIMAX_API_ENDPOINTS.global_en.openai)
    ).toBe('https://api.minimax.io');
    expect(
      normalizeMiniMaxApiBase(MINIMAX_API_ENDPOINTS.global_en.anthropic)
    ).toBe('https://api.minimax.io');
    expect(normalizeMiniMaxApiBase(MINIMAX_API_ENDPOINTS.cn_zh.openai)).toBe(
      'https://api.minimaxi.com'
    );
    expect(normalizeMiniMaxApiBase(MINIMAX_API_ENDPOINTS.cn_zh.anthropic)).toBe(
      'https://api.minimaxi.com'
    );
  });

  it('applies the selected model without changing the configured region', () => {
    const configPath = getMiniMaxConfigPath(testDir);
    mkdirSync(join(testDir, '.mini-agent', 'config'), { recursive: true });
    writeFileSync(
      configPath,
      [
        'api_key: test-key',
        `api_base: ${MINIMAX_API_ENDPOINTS.cn_zh.anthropic}`,
        'provider: anthropic',
        'model: MiniMax-M3',
      ].join('\n')
    );

    prepareMiniMaxConfig('MiniMax-M2.7', configPath);

    const config = parse(readFileSync(configPath, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(config.api_base).toBe('https://api.minimaxi.com');
    expect(config.provider).toBe('anthropic');
    expect(config.model).toBe('MiniMax-M2.7');
  });

  it('writes stdio and remote MCP entries in Mini-Agent format', () => {
    const configPath = join(testDir, 'mcp.json');

    writeMiniMaxMcpConfig(
      configPath,
      'workspace-tools',
      'tool-server --stdio',
      'stdio',
      ['WORKSPACE=/workspace'],
      []
    );
    writeMiniMaxMcpConfig(
      configPath,
      'remote-tools',
      'https://example.test/mcp',
      'http',
      [],
      ['Authorization: Bearer']
    );

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    expect(config.mcpServers['workspace-tools']).toMatchObject({
      command: 'tool-server',
      args: ['--stdio'],
      env: { WORKSPACE: '/workspace' },
    });
    expect(config.mcpServers['remote-tools']).toMatchObject({
      type: 'http',
      url: 'https://example.test/mcp',
      headers: { Authorization: 'Bearer' },
    });
  });

  it('uses the Mini-Agent ACP command and official install source', () => {
    const agent = new MiniMaxAgent('latest', 'MiniMax-M2.7');
    expect(agent.binary).toBe('mini-agent');
    expect(agent.acpCommand).toBe('mini-agent-acp');
    expect(agent.getInstallCommand()).toContain(
      'git+https://github.com/MiniMax-AI/Mini-Agent.git'
    );
  });
});
