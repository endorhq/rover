import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanupCommand } from '../cleanup.js';
import type { CacheImageInfo } from '../../lib/sandbox/container-image-cache.js';

// Mock sandbox backend detection
const mockGetAvailableSandboxBackend = vi.fn();
vi.mock('../../lib/sandbox/index.js', () => ({
  getAvailableSandboxBackend: (...args: any[]) =>
    mockGetAvailableSandboxBackend(...args),
}));

// Mock container-image-cache functions
const mockListCacheImages = vi.fn();
const mockRemoveCacheImage = vi.fn();
vi.mock('../../lib/sandbox/container-image-cache.js', () => ({
  listCacheImages: (...args: any[]) => mockListCacheImages(...args),
  removeCacheImage: (...args: any[]) => mockRemoveCacheImage(...args),
}));

// Mock rover-core
vi.mock('rover-core', async () => {
  const actual = await vi.importActual('rover-core');
  return {
    ...actual,
    ProjectStore: vi.fn().mockImplementation(() => ({
      list: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
    })),
    showTitle: vi.fn(),
    showProperties: vi.fn(),
  };
});

// Mock telemetry
vi.mock('../../lib/telemetry.js', () => ({
  getTelemetry: vi.fn().mockReturnValue({
    eventCleanup: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock context
vi.mock('../../lib/context.js', () => ({
  isJsonMode: vi.fn().mockReturnValue(false),
}));

// Mock exit utilities
const mockExitWithError = vi.fn();
const mockExitWithSuccess = vi.fn();
vi.mock('../../utils/exit.js', () => ({
  exitWithError: (...args: any[]) => mockExitWithError(...args),
  exitWithSuccess: (...args: any[]) => mockExitWithSuccess(...args),
}));

// Mock node:fs for existsSync
const mockExistsSync = vi.fn();
vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs');
  return {
    ...actual,
    existsSync: (...args: any[]) => mockExistsSync(...args),
  };
});

describe('cleanup command', () => {
  let savedDockerHost: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAvailableSandboxBackend.mockResolvedValue('docker');
    mockListCacheImages.mockResolvedValue([]);
    mockRemoveCacheImage.mockResolvedValue(true);
    mockExistsSync.mockReturnValue(true);
    // Isolate tests from the host environment
    savedDockerHost = process.env.DOCKER_HOST;
    delete process.env.DOCKER_HOST;
  });

  afterEach(() => {
    if (savedDockerHost !== undefined) {
      process.env.DOCKER_HOST = savedDockerHost;
    }
  });

  it('exits with error when no backend is available', async () => {
    mockGetAvailableSandboxBackend.mockResolvedValue(null);

    await cleanupCommand();

    expect(mockExitWithError).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('No container backend available'),
      }),
      expect.anything()
    );
  });

  it('exits with success when no cache images exist', async () => {
    mockListCacheImages.mockResolvedValue([]);

    await cleanupCommand();

    expect(mockExitWithSuccess).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        success: true,
        removedCount: 0,
        keptCount: 0,
        images: [],
      }),
      expect.anything()
    );
  });

  it('removes unlabeled (legacy) cache images', async () => {
    const images: CacheImageInfo[] = [
      {
        id: 'sha256:aaa',
        tag: 'rover-cache:abc123',
        createdAt: '2025-01-01T00:00:00Z',
        projectPath: null,
        agent: null,
      },
    ];

    mockListCacheImages.mockResolvedValue(images);

    await cleanupCommand();

    expect(mockRemoveCacheImage).toHaveBeenCalledTimes(1);
    expect(mockRemoveCacheImage).toHaveBeenCalledWith(
      'docker',
      'sha256:aaa',
      undefined
    );
    expect(mockExitWithSuccess).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        success: true,
        removedCount: 1,
        keptCount: 0,
      }),
      expect.anything()
    );
  });

  it('keeps the most recent image per project and removes older ones', async () => {
    const { ProjectStore } = await import('rover-core');
    vi.mocked(ProjectStore).mockImplementation(
      () =>
        ({
          list: vi.fn().mockReturnValue([{ path: '/home/user/project-a' }]),
          get: vi.fn().mockReturnValue(null),
        }) as any
    );

    const images: CacheImageInfo[] = [
      {
        id: 'sha256:new',
        tag: 'rover-cache:newer',
        createdAt: '2025-02-01T00:00:00Z',
        projectPath: '/home/user/project-a',
        agent: 'claude',
      },
      {
        id: 'sha256:old',
        tag: 'rover-cache:older',
        createdAt: '2025-01-01T00:00:00Z',
        projectPath: '/home/user/project-a',
        agent: 'claude',
      },
    ];

    mockListCacheImages.mockResolvedValue(images);

    await cleanupCommand();

    expect(mockRemoveCacheImage).toHaveBeenCalledTimes(1);
    expect(mockRemoveCacheImage).toHaveBeenCalledWith(
      'docker',
      'sha256:old',
      undefined
    );
    expect(mockExitWithSuccess).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        removedCount: 1,
        keptCount: 1,
      }),
      expect.anything()
    );
  });

  it('keeps the latest image per agent for the same project', async () => {
    const { ProjectStore } = await import('rover-core');
    vi.mocked(ProjectStore).mockImplementation(
      () =>
        ({
          list: vi.fn().mockReturnValue([{ path: '/home/user/project-a' }]),
          get: vi.fn().mockReturnValue(null),
        }) as any
    );

    const images: CacheImageInfo[] = [
      {
        id: 'sha256:claude-img',
        tag: 'rover-cache:claude1',
        createdAt: '2025-01-01T00:00:00Z',
        projectPath: '/home/user/project-a',
        agent: 'claude',
      },
      {
        id: 'sha256:codex-img',
        tag: 'rover-cache:codex1',
        createdAt: '2025-01-02T00:00:00Z',
        projectPath: '/home/user/project-a',
        agent: 'codex',
      },
    ];

    mockListCacheImages.mockResolvedValue(images);

    await cleanupCommand();

    // Both images should be kept — one per agent
    expect(mockRemoveCacheImage).not.toHaveBeenCalled();
    expect(mockExitWithSuccess).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        keptCount: 2,
      }),
      expect.anything()
    );
  });

  it('removes older images per agent while keeping latest for each', async () => {
    const { ProjectStore } = await import('rover-core');
    vi.mocked(ProjectStore).mockImplementation(
      () =>
        ({
          list: vi.fn().mockReturnValue([{ path: '/home/user/project-a' }]),
          get: vi.fn().mockReturnValue(null),
        }) as any
    );

    const images: CacheImageInfo[] = [
      {
        id: 'sha256:claude-new',
        tag: 'rover-cache:claude-new',
        createdAt: '2025-02-01T00:00:00Z',
        projectPath: '/home/user/project-a',
        agent: 'claude',
      },
      {
        id: 'sha256:claude-old',
        tag: 'rover-cache:claude-old',
        createdAt: '2025-01-01T00:00:00Z',
        projectPath: '/home/user/project-a',
        agent: 'claude',
      },
      {
        id: 'sha256:codex-img',
        tag: 'rover-cache:codex1',
        createdAt: '2025-01-15T00:00:00Z',
        projectPath: '/home/user/project-a',
        agent: 'codex',
      },
    ];

    mockListCacheImages.mockResolvedValue(images);

    await cleanupCommand();

    // Only the older claude image should be removed
    expect(mockRemoveCacheImage).toHaveBeenCalledTimes(1);
    expect(mockRemoveCacheImage).toHaveBeenCalledWith(
      'docker',
      'sha256:claude-old',
      undefined
    );
    expect(mockExitWithSuccess).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        removedCount: 1,
        keptCount: 2,
      }),
      expect.anything()
    );
  });

  it('removes images whose project path no longer exists', async () => {
    mockExistsSync.mockReturnValue(false);

    const images: CacheImageInfo[] = [
      {
        id: 'sha256:orphan',
        tag: 'rover-cache:orphaned',
        createdAt: '2025-01-01T00:00:00Z',
        projectPath: '/home/user/deleted-project',
        agent: 'claude',
      },
    ];

    mockListCacheImages.mockResolvedValue(images);

    await cleanupCommand();

    expect(mockRemoveCacheImage).toHaveBeenCalledTimes(1);
    expect(mockRemoveCacheImage).toHaveBeenCalledWith(
      'docker',
      'sha256:orphan',
      undefined
    );
  });

  it('removes images whose project is not registered in store', async () => {
    // Project path exists on disk but not in store
    mockExistsSync.mockReturnValue(true);

    const images: CacheImageInfo[] = [
      {
        id: 'sha256:unreg',
        tag: 'rover-cache:unregistered',
        createdAt: '2025-01-01T00:00:00Z',
        projectPath: '/home/user/unregistered-project',
        agent: 'claude',
      },
    ];

    mockListCacheImages.mockResolvedValue(images);

    await cleanupCommand();

    expect(mockRemoveCacheImage).toHaveBeenCalledTimes(1);
  });

  it('does not remove images in dry-run mode', async () => {
    const images: CacheImageInfo[] = [
      {
        id: 'sha256:aaa',
        tag: 'rover-cache:abc123',
        createdAt: '2025-01-01T00:00:00Z',
        projectPath: null,
        agent: null,
      },
    ];

    mockListCacheImages.mockResolvedValue(images);

    await cleanupCommand({ dryRun: true });

    expect(mockRemoveCacheImage).not.toHaveBeenCalled();
    expect(mockExitWithSuccess).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        success: true,
        removedCount: 0,
      }),
      expect.anything()
    );
  });

  it('reports all images when all are current', async () => {
    const { ProjectStore } = await import('rover-core');
    vi.mocked(ProjectStore).mockImplementation(
      () =>
        ({
          list: vi.fn().mockReturnValue([{ path: '/home/user/project-a' }]),
          get: vi.fn().mockReturnValue(null),
        }) as any
    );

    const images: CacheImageInfo[] = [
      {
        id: 'sha256:current',
        tag: 'rover-cache:current1',
        createdAt: '2025-01-01T00:00:00Z',
        projectPath: '/home/user/project-a',
        agent: 'claude',
      },
    ];

    mockListCacheImages.mockResolvedValue(images);

    await cleanupCommand();

    expect(mockRemoveCacheImage).not.toHaveBeenCalled();
    expect(mockExitWithSuccess).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        keptCount: 1,
      }),
      expect.anything()
    );
  });

  it('calls telemetry eventCleanup', async () => {
    const { getTelemetry } = await import('../../lib/telemetry.js');
    const mockTelemetry = getTelemetry();

    await cleanupCommand();

    expect(mockTelemetry?.eventCleanup).toHaveBeenCalled();
  });

  it('lists images on multiple DOCKER_HOSTs from task metadata', async () => {
    const { ProjectStore } = await import('rover-core');
    vi.mocked(ProjectStore).mockImplementation(
      () =>
        ({
          list: vi
            .fn()
            .mockReturnValue([{ id: 'proj-1', path: '/home/user/project-a' }]),
          get: vi.fn().mockReturnValue({
            listTasks: vi
              .fn()
              .mockReturnValue([
                { sandboxMetadata: { dockerHost: 'tcp://remote:2375' } },
                { sandboxMetadata: undefined },
              ]),
          }),
        }) as any
    );

    // First call: default host (undefined metadata) → returns one image
    // Second call: remote host → returns another image
    mockListCacheImages
      .mockResolvedValueOnce([
        {
          id: 'sha256:local',
          tag: 'rover-cache:local1',
          createdAt: '2025-01-01T00:00:00Z',
          projectPath: '/home/user/project-a',
          agent: 'claude',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'sha256:remote',
          tag: 'rover-cache:remote1',
          createdAt: '2025-01-02T00:00:00Z',
          projectPath: '/home/user/project-a',
          agent: 'claude',
        },
      ]);

    await cleanupCommand();

    // Should have queried both hosts
    expect(mockListCacheImages).toHaveBeenCalledTimes(2);
    expect(mockListCacheImages).toHaveBeenCalledWith('docker', undefined);
    expect(mockListCacheImages).toHaveBeenCalledWith('docker', {
      dockerHost: 'tcp://remote:2375',
    });

    // The remote image is newer, so local gets removed with its metadata
    expect(mockRemoveCacheImage).toHaveBeenCalledTimes(1);
    expect(mockRemoveCacheImage).toHaveBeenCalledWith(
      'docker',
      'sha256:local',
      undefined
    );
  });

  it('scans the current DOCKER_HOST when set in the environment', async () => {
    const { ProjectStore } = await import('rover-core');
    vi.mocked(ProjectStore).mockImplementation(
      () =>
        ({
          list: vi.fn().mockReturnValue([]),
          get: vi.fn().mockReturnValue(null),
        }) as any
    );

    process.env.DOCKER_HOST = 'unix:///var/run/docker.sock';

    // Default (undefined) returns nothing, explicit DOCKER_HOST returns one image
    mockListCacheImages.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'sha256:env-host',
        tag: 'rover-cache:envhost1',
        createdAt: '2025-01-01T00:00:00Z',
        projectPath: null,
        agent: null,
      },
    ]);

    await cleanupCommand();

    expect(mockListCacheImages).toHaveBeenCalledTimes(2);
    expect(mockListCacheImages).toHaveBeenCalledWith('docker', undefined);
    expect(mockListCacheImages).toHaveBeenCalledWith('docker', {
      dockerHost: 'unix:///var/run/docker.sock',
    });

    expect(mockRemoveCacheImage).toHaveBeenCalledTimes(1);
    expect(mockRemoveCacheImage).toHaveBeenCalledWith(
      'docker',
      'sha256:env-host',
      { dockerHost: 'unix:///var/run/docker.sock' }
    );
  });

  it('passes correct sandboxMetadata when removing images from remote host', async () => {
    const { ProjectStore } = await import('rover-core');
    vi.mocked(ProjectStore).mockImplementation(
      () =>
        ({
          list: vi
            .fn()
            .mockReturnValue([{ id: 'proj-1', path: '/home/user/project-a' }]),
          get: vi.fn().mockReturnValue({
            listTasks: vi
              .fn()
              .mockReturnValue([
                { sandboxMetadata: { dockerHost: 'tcp://remote:2375' } },
              ]),
          }),
        }) as any
    );

    // Default host: no images
    // Remote host: one unlabeled (legacy) image to remove
    mockListCacheImages.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'sha256:remote-legacy',
        tag: 'rover-cache:legacy1',
        createdAt: '2025-01-01T00:00:00Z',
        projectPath: null,
        agent: null,
      },
    ]);

    await cleanupCommand();

    // Should remove with the remote sandboxMetadata
    expect(mockRemoveCacheImage).toHaveBeenCalledWith(
      'docker',
      'sha256:remote-legacy',
      { dockerHost: 'tcp://remote:2375' }
    );
  });
});
