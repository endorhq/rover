import { describe, it, expect, vi, beforeEach } from 'vitest';
import { launch } from 'rover-core';
import {
  computeSetupHash,
  getCacheImageTag,
  getCacheImageLabels,
  listCacheImages,
  removeCacheImage,
  waitForInitAndCommit,
  type SetupHashInputs,
} from '../container-image-cache.js';
import { ContainerBackend } from '../container-common.js';

vi.mock('rover-core', async () => {
  const actual = await vi.importActual('rover-core');
  return {
    ...actual,
    launch: vi.fn(),
  };
});

function makeInputs(overrides: Partial<SetupHashInputs> = {}): SetupHashInputs {
  return {
    agentImage: 'ghcr.io/endorhq/rover/agent:v1.0.0',
    languages: ['typescript', 'javascript'],
    packageManagers: ['pnpm', 'npm'],
    taskManagers: ['make'],
    agent: 'claude',
    roverVersion: '1.0.0',
    initScriptContent: '',
    cacheFilesContent: '',
    mcps: [],
    ...overrides,
  };
}

describe('computeSetupHash', () => {
  it('returns a deterministic hex string', () => {
    const inputs = makeInputs();
    const hash1 = computeSetupHash(inputs);
    const hash2 = computeSetupHash(inputs);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when agentImage changes', () => {
    const a = computeSetupHash(makeInputs({ agentImage: 'img:v1' }));
    const b = computeSetupHash(makeInputs({ agentImage: 'img:v2' }));
    expect(a).not.toBe(b);
  });

  it('changes when languages change', () => {
    const a = computeSetupHash(makeInputs({ languages: ['typescript'] }));
    const b = computeSetupHash(
      makeInputs({ languages: ['typescript', 'python'] })
    );
    expect(a).not.toBe(b);
  });

  it('changes when packageManagers change', () => {
    const a = computeSetupHash(makeInputs({ packageManagers: ['pnpm'] }));
    const b = computeSetupHash(
      makeInputs({ packageManagers: ['pnpm', 'yarn'] })
    );
    expect(a).not.toBe(b);
  });

  it('changes when taskManagers change', () => {
    const a = computeSetupHash(makeInputs({ taskManagers: ['make'] }));
    const b = computeSetupHash(makeInputs({ taskManagers: ['just'] }));
    expect(a).not.toBe(b);
  });

  it('changes when agent changes', () => {
    const a = computeSetupHash(makeInputs({ agent: 'claude' }));
    const b = computeSetupHash(makeInputs({ agent: 'gemini' }));
    expect(a).not.toBe(b);
  });

  it('changes when roverVersion changes', () => {
    const a = computeSetupHash(makeInputs({ roverVersion: '1.0.0' }));
    const b = computeSetupHash(makeInputs({ roverVersion: '2.0.0' }));
    expect(a).not.toBe(b);
  });

  it('changes when initScriptContent changes', () => {
    const a = computeSetupHash(makeInputs({ initScriptContent: '' }));
    const b = computeSetupHash(
      makeInputs({ initScriptContent: 'apt-get install -y vim' })
    );
    expect(a).not.toBe(b);
  });

  it('changes when cacheFilesContent changes', () => {
    const a = computeSetupHash(makeInputs({ cacheFilesContent: '' }));
    const b = computeSetupHash(
      makeInputs({
        cacheFilesContent:
          'requirements.txt\0flask==2.0\0package-lock.json\0{}',
      })
    );
    expect(a).not.toBe(b);
  });

  it('produces same hash when cacheFilesContent is empty (backward compat)', () => {
    const a = computeSetupHash(makeInputs());
    const b = computeSetupHash(makeInputs({ cacheFilesContent: '' }));
    expect(a).toBe(b);
  });

  it('changes when mcps change', () => {
    const a = computeSetupHash(makeInputs({ mcps: [] }));
    const b = computeSetupHash(
      makeInputs({
        mcps: [
          {
            name: 'my-mcp',
            commandOrUrl: 'http://localhost:9090',
            transport: 'http',
          },
        ],
      })
    );
    expect(a).not.toBe(b);
  });

  it('is unaffected by array ordering of languages', () => {
    const a = computeSetupHash(
      makeInputs({ languages: ['typescript', 'javascript'] })
    );
    const b = computeSetupHash(
      makeInputs({ languages: ['javascript', 'typescript'] })
    );
    expect(a).toBe(b);
  });

  it('is unaffected by array ordering of packageManagers', () => {
    const a = computeSetupHash(
      makeInputs({ packageManagers: ['pnpm', 'npm'] })
    );
    const b = computeSetupHash(
      makeInputs({ packageManagers: ['npm', 'pnpm'] })
    );
    expect(a).toBe(b);
  });

  it('is unaffected by array ordering of taskManagers', () => {
    const a = computeSetupHash(makeInputs({ taskManagers: ['make', 'just'] }));
    const b = computeSetupHash(makeInputs({ taskManagers: ['just', 'make'] }));
    expect(a).toBe(b);
  });

  it('is unaffected by array ordering of mcps', () => {
    const mcpA = {
      name: 'alpha',
      commandOrUrl: 'http://a',
      transport: 'http',
    };
    const mcpB = {
      name: 'beta',
      commandOrUrl: 'http://b',
      transport: 'stdio',
    };
    const a = computeSetupHash(makeInputs({ mcps: [mcpA, mcpB] }));
    const b = computeSetupHash(makeInputs({ mcps: [mcpB, mcpA] }));
    expect(a).toBe(b);
  });

  it('is unaffected by ordering of mcp envs and headers', () => {
    const a = computeSetupHash(
      makeInputs({
        mcps: [
          {
            name: 'test',
            commandOrUrl: 'http://x',
            transport: 'http',
            envs: ['B=2', 'A=1'],
            headers: ['Y: 2', 'X: 1'],
          },
        ],
      })
    );
    const b = computeSetupHash(
      makeInputs({
        mcps: [
          {
            name: 'test',
            commandOrUrl: 'http://x',
            transport: 'http',
            envs: ['A=1', 'B=2'],
            headers: ['X: 1', 'Y: 2'],
          },
        ],
      })
    );
    expect(a).toBe(b);
  });
});

describe('getCacheImageTag', () => {
  it('returns rover-cache: prefix with 16 hex chars', () => {
    const hash =
      'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const tag = getCacheImageTag(hash);
    expect(tag).toBe('rover-cache:abcdef0123456789');
  });

  it('uses the first 16 characters of the hash', () => {
    const inputs = makeInputs();
    const hash = computeSetupHash(inputs);
    const tag = getCacheImageTag(hash);
    expect(tag).toBe(`rover-cache:${hash.slice(0, 16)}`);
    expect(tag).toMatch(/^rover-cache:[0-9a-f]{16}$/);
  });
});

describe('waitForInitAndCommit', () => {
  const mockedLaunch = vi.mocked(launch);

  beforeEach(() => {
    mockedLaunch.mockReset();
  });

  it('commits and returns true when exit code is 0', async () => {
    mockedLaunch.mockResolvedValueOnce({
      stdout: '0\n',
    } as any);
    mockedLaunch.mockResolvedValueOnce({} as any); // commit
    mockedLaunch.mockResolvedValueOnce({} as any); // rm -f

    const result = await waitForInitAndCommit(
      ContainerBackend.Docker,
      'test-container',
      'rover-cache:abc123'
    );

    expect(result).toBe(true);
    expect(mockedLaunch).toHaveBeenCalledTimes(3);
    expect(mockedLaunch).toHaveBeenNthCalledWith(
      1,
      ContainerBackend.Docker,
      ['wait', 'test-container'],
      undefined
    );
    expect(mockedLaunch).toHaveBeenNthCalledWith(
      2,
      ContainerBackend.Docker,
      ['commit', 'test-container', 'rover-cache:abc123'],
      undefined
    );
    expect(mockedLaunch).toHaveBeenNthCalledWith(
      3,
      ContainerBackend.Docker,
      ['rm', '-f', 'test-container'],
      undefined
    );
  });

  it('includes LABEL change when projectPath is provided', async () => {
    mockedLaunch.mockResolvedValueOnce({
      stdout: '0\n',
    } as any);
    mockedLaunch.mockResolvedValueOnce({} as any); // commit
    mockedLaunch.mockResolvedValueOnce({} as any); // rm -f

    const result = await waitForInitAndCommit(
      ContainerBackend.Docker,
      'test-container',
      'rover-cache:abc123',
      '/home/user/my-project'
    );

    expect(result).toBe(true);
    expect(mockedLaunch).toHaveBeenNthCalledWith(
      2,
      ContainerBackend.Docker,
      [
        'commit',
        '--change',
        'LABEL rover.project.path=/home/user/my-project',
        'test-container',
        'rover-cache:abc123',
      ],
      undefined
    );
  });

  it('includes agent LABEL when agent is provided', async () => {
    mockedLaunch.mockResolvedValueOnce({
      stdout: '0\n',
    } as any);
    mockedLaunch.mockResolvedValueOnce({} as any); // commit
    mockedLaunch.mockResolvedValueOnce({} as any); // rm -f

    const result = await waitForInitAndCommit(
      ContainerBackend.Docker,
      'test-container',
      'rover-cache:abc123',
      '/home/user/my-project',
      'claude'
    );

    expect(result).toBe(true);
    expect(mockedLaunch).toHaveBeenNthCalledWith(
      2,
      ContainerBackend.Docker,
      [
        'commit',
        '--change',
        'LABEL rover.project.path=/home/user/my-project',
        '--change',
        'LABEL rover.agent=claude',
        'test-container',
        'rover-cache:abc123',
      ],
      undefined
    );
  });

  it('forwards DOCKER_HOST via sandboxMetadata to all launch calls', async () => {
    mockedLaunch.mockResolvedValueOnce({
      stdout: '0\n',
    } as any);
    mockedLaunch.mockResolvedValueOnce({} as any); // commit
    mockedLaunch.mockResolvedValueOnce({} as any); // rm -f

    const metadata = { dockerHost: 'tcp://remote:2375' };
    const result = await waitForInitAndCommit(
      ContainerBackend.Docker,
      'test-container',
      'rover-cache:abc123',
      '/home/user/proj',
      'claude',
      metadata
    );

    expect(result).toBe(true);
    // Every launch call should receive { env: { DOCKER_HOST: ... } }
    for (let i = 1; i <= 3; i++) {
      const callOpts = mockedLaunch.mock.calls[i - 1][2] as any;
      expect(callOpts?.env?.DOCKER_HOST).toBe('tcp://remote:2375');
    }
  });

  it('does not commit and returns false when exit code is 1', async () => {
    mockedLaunch.mockResolvedValueOnce({
      stdout: '1\n',
    } as any);
    mockedLaunch.mockResolvedValueOnce({} as any); // rm -f

    const result = await waitForInitAndCommit(
      ContainerBackend.Podman,
      'test-container',
      'rover-cache:abc123'
    );

    expect(result).toBe(false);
    expect(mockedLaunch).toHaveBeenCalledTimes(2);
    expect(mockedLaunch).toHaveBeenNthCalledWith(
      1,
      ContainerBackend.Podman,
      ['wait', 'test-container'],
      undefined
    );
    expect(mockedLaunch).toHaveBeenNthCalledWith(
      2,
      ContainerBackend.Podman,
      ['rm', '-f', 'test-container'],
      undefined
    );
  });

  it('returns false when launch throws', async () => {
    mockedLaunch.mockRejectedValueOnce(new Error('wait failed'));
    mockedLaunch.mockResolvedValueOnce({} as any); // cleanup rm -f

    const result = await waitForInitAndCommit(
      ContainerBackend.Docker,
      'test-container',
      'rover-cache:abc123'
    );

    expect(result).toBe(false);
  });
});

describe('listCacheImages', () => {
  const mockedLaunch = vi.mocked(launch);

  beforeEach(() => {
    mockedLaunch.mockReset();
  });

  it('returns empty array when no images exist', async () => {
    mockedLaunch.mockResolvedValueOnce({ stdout: '' } as any);
    const result = await listCacheImages(ContainerBackend.Docker);
    expect(result).toEqual([]);
  });

  it('parses NDJSON output (Docker format)', async () => {
    const ndjson = [
      JSON.stringify({
        ID: 'sha256:abc123',
        Tag: 'abcdef0123456789',
        Repository: 'rover-cache',
        CreatedAt: '2025-01-01T00:00:00Z',
      }),
      JSON.stringify({
        ID: 'sha256:def456',
        Tag: '1234567890abcdef',
        Repository: 'rover-cache',
        CreatedAt: '2025-01-02T00:00:00Z',
      }),
    ].join('\n');

    mockedLaunch.mockResolvedValueOnce({ stdout: ndjson } as any);
    // getCacheImageLabels calls for each image
    mockedLaunch.mockResolvedValueOnce({
      stdout: JSON.stringify({ 'rover.project.path': '/home/user/proj1' }),
    } as any);
    mockedLaunch.mockResolvedValueOnce({
      stdout: 'null',
    } as any);

    const result = await listCacheImages(ContainerBackend.Docker);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'sha256:abc123',
      tag: 'rover-cache:abcdef0123456789',
      createdAt: '2025-01-01T00:00:00Z',
      projectPath: '/home/user/proj1',
      agent: null,
    });
    expect(result[1]).toEqual({
      id: 'sha256:def456',
      tag: 'rover-cache:1234567890abcdef',
      createdAt: '2025-01-02T00:00:00Z',
      projectPath: null,
      agent: null,
    });
  });

  it('parses JSON array output (Podman format)', async () => {
    const jsonArray = JSON.stringify([
      {
        ID: 'sha256:abc123',
        Tag: 'abcdef0123456789',
        Repository: 'rover-cache',
        CreatedAt: '2025-01-01T00:00:00Z',
      },
    ]);

    mockedLaunch.mockResolvedValueOnce({ stdout: jsonArray } as any);
    mockedLaunch.mockResolvedValueOnce({
      stdout: JSON.stringify({ 'rover.project.path': '/tmp/proj' }),
    } as any);

    const result = await listCacheImages(ContainerBackend.Podman);

    expect(result).toHaveLength(1);
    expect(result[0].projectPath).toBe('/tmp/proj');
    expect(result[0].agent).toBeNull();
  });

  it('returns empty array on error', async () => {
    mockedLaunch.mockRejectedValueOnce(new Error('docker not running'));
    const result = await listCacheImages(ContainerBackend.Docker);
    expect(result).toEqual([]);
  });

  it('forwards DOCKER_HOST via sandboxMetadata', async () => {
    mockedLaunch.mockResolvedValueOnce({ stdout: '' } as any);
    const metadata = { dockerHost: 'tcp://remote:2375' };
    await listCacheImages(ContainerBackend.Docker, metadata);

    const callOpts = mockedLaunch.mock.calls[0][2] as any;
    expect(callOpts?.env?.DOCKER_HOST).toBe('tcp://remote:2375');
  });
});

describe('getCacheImageLabels', () => {
  const mockedLaunch = vi.mocked(launch);

  beforeEach(() => {
    mockedLaunch.mockReset();
  });

  it('returns parsed labels', async () => {
    mockedLaunch.mockResolvedValueOnce({
      stdout: JSON.stringify({
        'rover.project.path': '/home/user/proj',
        'other.label': 'value',
      }),
    } as any);

    const labels = await getCacheImageLabels(
      ContainerBackend.Docker,
      'sha256:abc'
    );
    expect(labels).toEqual({
      'rover.project.path': '/home/user/proj',
      'other.label': 'value',
    });
  });

  it('returns empty object for null output', async () => {
    mockedLaunch.mockResolvedValueOnce({ stdout: 'null' } as any);
    const labels = await getCacheImageLabels(
      ContainerBackend.Docker,
      'sha256:abc'
    );
    expect(labels).toEqual({});
  });

  it('returns empty object on error', async () => {
    mockedLaunch.mockRejectedValueOnce(new Error('inspect failed'));
    const labels = await getCacheImageLabels(
      ContainerBackend.Docker,
      'sha256:abc'
    );
    expect(labels).toEqual({});
  });

  it('forwards DOCKER_HOST via sandboxMetadata', async () => {
    mockedLaunch.mockResolvedValueOnce({
      stdout: JSON.stringify({ 'rover.project.path': '/tmp/proj' }),
    } as any);
    const metadata = { dockerHost: 'unix:///custom/docker.sock' };
    await getCacheImageLabels(ContainerBackend.Docker, 'sha256:abc', metadata);

    const callOpts = mockedLaunch.mock.calls[0][2] as any;
    expect(callOpts?.env?.DOCKER_HOST).toBe('unix:///custom/docker.sock');
  });
});

describe('removeCacheImage', () => {
  const mockedLaunch = vi.mocked(launch);

  beforeEach(() => {
    mockedLaunch.mockReset();
  });

  it('returns true on successful removal', async () => {
    mockedLaunch.mockResolvedValueOnce({} as any);
    const result = await removeCacheImage(
      ContainerBackend.Docker,
      'sha256:abc'
    );
    expect(result).toBe(true);
    expect(mockedLaunch).toHaveBeenCalledWith(
      ContainerBackend.Docker,
      ['rmi', '--force', 'sha256:abc'],
      undefined
    );
  });

  it('forwards DOCKER_HOST via sandboxMetadata', async () => {
    mockedLaunch.mockResolvedValueOnce({} as any);
    const metadata = { dockerHost: 'tcp://remote:2375' };
    const result = await removeCacheImage(
      ContainerBackend.Docker,
      'sha256:abc',
      metadata
    );
    expect(result).toBe(true);
    const callOpts = mockedLaunch.mock.calls[0][2] as any;
    expect(callOpts?.env?.DOCKER_HOST).toBe('tcp://remote:2375');
  });

  it('returns false on error', async () => {
    mockedLaunch.mockRejectedValueOnce(new Error('image in use'));
    const result = await removeCacheImage(
      ContainerBackend.Docker,
      'sha256:abc'
    );
    expect(result).toBe(false);
  });
});
