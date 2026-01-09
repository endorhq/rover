import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Sandbox Configuration', () => {
  // Store original env
  const originalEnv = { ...process.env };

  // Clear sandbox-related env vars before importing the module
  beforeEach(async () => {
    vi.resetModules();
    // Clear ALL sandbox-related env vars
    delete process.env.ROVER_SECURITY_LEVEL;
    delete process.env.ROVER_NETWORK_MODE;
    delete process.env.ROVER_MEMORY_LIMIT;
    delete process.env.ROVER_CPU_LIMIT;
    delete process.env.ROVER_PIDS_LIMIT;
    delete process.env.ROVER_SANDBOX_BACKEND;
    delete process.env.ROVER_USE_GVISOR;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  // Helper to dynamically import the module (fresh import each time)
  async function importConfig() {
    return await import('../config.js');
  }

  describe('loadSandboxConfig', () => {
    it('should return default config when no env vars are set', async () => {
      const { loadSandboxConfig } = await importConfig();
      const config = loadSandboxConfig();

      expect(config.securityLevel).toBe('standard');
      expect(config.networkMode).toBe('full');
      expect(config.resources.memory).toBe('4g');
      expect(config.resources.cpus).toBe('2');
      expect(config.resources.pidsLimit).toBe(256);
      expect(config.forceBackend).toBeUndefined();
    });

    it('should respect ROVER_SECURITY_LEVEL env var', async () => {
      process.env.ROVER_SECURITY_LEVEL = 'enhanced';
      const { loadSandboxConfig } = await importConfig();
      const config = loadSandboxConfig();
      expect(config.securityLevel).toBe('enhanced');
    });

    it('should support maximum security level', async () => {
      process.env.ROVER_SECURITY_LEVEL = 'maximum';
      const { loadSandboxConfig } = await importConfig();
      const config = loadSandboxConfig();
      expect(config.securityLevel).toBe('maximum');
    });

    it('should ignore invalid ROVER_SECURITY_LEVEL values', async () => {
      process.env.ROVER_SECURITY_LEVEL = 'invalid';
      const { loadSandboxConfig } = await importConfig();
      const config = loadSandboxConfig();
      expect(config.securityLevel).toBe('standard');
    });

    it('should respect ROVER_NETWORK_MODE env var for none', async () => {
      process.env.ROVER_NETWORK_MODE = 'none';
      const { loadSandboxConfig } = await importConfig();
      const config = loadSandboxConfig();
      expect(config.networkMode).toBe('none');
    });

    it('should respect ROVER_NETWORK_MODE env var for restricted', async () => {
      process.env.ROVER_NETWORK_MODE = 'restricted';
      const { loadSandboxConfig } = await importConfig();
      const config = loadSandboxConfig();
      expect(config.networkMode).toBe('restricted');
    });

    it('should ignore invalid ROVER_NETWORK_MODE values', async () => {
      process.env.ROVER_NETWORK_MODE = 'invalid';
      const { loadSandboxConfig } = await importConfig();
      const config = loadSandboxConfig();
      expect(config.networkMode).toBe('full');
    });

    it('should respect resource limit env vars', async () => {
      process.env.ROVER_MEMORY_LIMIT = '8g';
      process.env.ROVER_CPU_LIMIT = '4';
      process.env.ROVER_PIDS_LIMIT = '512';

      const { loadSandboxConfig } = await importConfig();
      const config = loadSandboxConfig();

      expect(config.resources.memory).toBe('8g');
      expect(config.resources.cpus).toBe('4');
      expect(config.resources.pidsLimit).toBe(512);
    });

    it('should ignore invalid ROVER_PIDS_LIMIT values', async () => {
      process.env.ROVER_PIDS_LIMIT = 'invalid';
      const { loadSandboxConfig } = await importConfig();
      const config = loadSandboxConfig();
      expect(config.resources.pidsLimit).toBe(256); // default
    });

    it('should ignore negative ROVER_PIDS_LIMIT values', async () => {
      process.env.ROVER_PIDS_LIMIT = '-1';
      const { loadSandboxConfig } = await importConfig();
      const config = loadSandboxConfig();
      expect(config.resources.pidsLimit).toBe(256); // default (negative ignored)
    });

    it('should respect ROVER_SANDBOX_BACKEND env var for gvisor', async () => {
      process.env.ROVER_SANDBOX_BACKEND = 'gvisor';
      const { loadSandboxConfig } = await importConfig();
      const config = loadSandboxConfig();
      expect(config.forceBackend).toBe('gvisor');
    });

    it('should respect ROVER_SANDBOX_BACKEND env var for firecracker', async () => {
      process.env.ROVER_SANDBOX_BACKEND = 'firecracker';
      const { loadSandboxConfig } = await importConfig();
      const config = loadSandboxConfig();
      expect(config.forceBackend).toBe('firecracker');
    });

    it('should handle legacy ROVER_USE_GVISOR env var', async () => {
      process.env.ROVER_USE_GVISOR = 'true';
      const { loadSandboxConfig } = await importConfig();
      const config = loadSandboxConfig();
      expect(config.securityLevel).toBe('enhanced');
    });

    it('should prioritize ROVER_SANDBOX_BACKEND over ROVER_USE_GVISOR', async () => {
      process.env.ROVER_USE_GVISOR = 'true';
      process.env.ROVER_SANDBOX_BACKEND = 'docker';
      const { loadSandboxConfig } = await importConfig();
      const config = loadSandboxConfig();
      // forceBackend should be set, and legacy var should not affect securityLevel
      expect(config.forceBackend).toBe('docker');
    });
  });

  describe('getResourceLimitArgs', () => {
    it('should return empty array for empty config', async () => {
      const { getResourceLimitArgs } = await importConfig();
      const args = getResourceLimitArgs({});
      expect(args).toEqual([]);
    });

    it('should return memory limit args', async () => {
      const { getResourceLimitArgs } = await importConfig();
      const args = getResourceLimitArgs({ memory: '4g' });
      expect(args).toEqual(['--memory', '4g']);
    });

    it('should return CPU limit args', async () => {
      const { getResourceLimitArgs } = await importConfig();
      const args = getResourceLimitArgs({ cpus: '2' });
      expect(args).toEqual(['--cpus', '2']);
    });

    it('should return pids limit args', async () => {
      const { getResourceLimitArgs } = await importConfig();
      const args = getResourceLimitArgs({ pidsLimit: 256 });
      expect(args).toEqual(['--pids-limit', '256']);
    });

    it('should return all limit args when all are specified', async () => {
      const { getResourceLimitArgs } = await importConfig();
      const args = getResourceLimitArgs({
        memory: '8g',
        cpus: '4',
        pidsLimit: 512,
      });
      expect(args).toEqual([
        '--memory',
        '8g',
        '--cpus',
        '4',
        '--pids-limit',
        '512',
      ]);
    });
  });

  describe('getNetworkArgs', () => {
    it('should return empty array for full network mode', async () => {
      const { getNetworkArgs } = await importConfig();
      const args = getNetworkArgs('full');
      expect(args).toEqual([]);
    });

    it('should return --network=none for none mode', async () => {
      const { getNetworkArgs } = await importConfig();
      const args = getNetworkArgs('none');
      expect(args).toEqual(['--network', 'none']);
    });

    it('should return bridge network for restricted mode', async () => {
      const { getNetworkArgs } = await importConfig();
      const args = getNetworkArgs('restricted');
      expect(args).toEqual(['--network', 'bridge']);
    });
  });

  describe('getGVisorRuntimeArgs', () => {
    it('should return empty array when gVisor is disabled', async () => {
      const { getGVisorRuntimeArgs } = await importConfig();
      const args = getGVisorRuntimeArgs(false);
      expect(args).toEqual([]);
    });

    it('should return runtime args when gVisor is enabled', async () => {
      const { getGVisorRuntimeArgs } = await importConfig();
      const args = getGVisorRuntimeArgs(true);
      expect(args).toEqual(['--runtime', 'runsc']);
    });
  });

  describe('DEFAULT_SANDBOX_CONFIG', () => {
    it('should have sensible defaults', async () => {
      const { DEFAULT_SANDBOX_CONFIG } = await importConfig();
      expect(DEFAULT_SANDBOX_CONFIG.securityLevel).toBe('standard');
      expect(DEFAULT_SANDBOX_CONFIG.networkMode).toBe('full');
      expect(DEFAULT_SANDBOX_CONFIG.resources.memory).toBe('4g');
      expect(DEFAULT_SANDBOX_CONFIG.resources.cpus).toBe('2');
      expect(DEFAULT_SANDBOX_CONFIG.resources.pidsLimit).toBe(256);
    });
  });

  describe('ALLOWED_API_HOSTS', () => {
    it('should include Anthropic API hosts', async () => {
      const { ALLOWED_API_HOSTS } = await importConfig();
      expect(ALLOWED_API_HOSTS).toContain('api.anthropic.com');
      expect(ALLOWED_API_HOSTS).toContain('api.claude.ai');
    });

    it('should include Google API hosts', async () => {
      const { ALLOWED_API_HOSTS } = await importConfig();
      expect(ALLOWED_API_HOSTS).toContain('generativelanguage.googleapis.com');
    });

    it('should include package registries', async () => {
      const { ALLOWED_API_HOSTS } = await importConfig();
      expect(ALLOWED_API_HOSTS).toContain('registry.npmjs.org');
      expect(ALLOWED_API_HOSTS).toContain('pypi.org');
    });
  });
});
