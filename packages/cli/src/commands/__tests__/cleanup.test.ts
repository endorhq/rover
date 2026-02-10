import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanupCommand } from '../cleanup.js';
import type { CacheImageInfo } from '../../lib/sandbox/image-cache.js';

// Mock sandbox backend detection
const mockGetAvailableSandboxBackend = vi.fn();
vi.mock('../../lib/sandbox/index.js', () => ({
  getAvailableSandboxBackend: (...args: any[]) =>
    mockGetAvailableSandboxBackend(...args),
}));

// Mock image-cache functions
const mockListCacheImages = vi.fn();
const mockRemoveCacheImage = vi.fn();
vi.mock('../../lib/sandbox/image-cache.js', () => ({
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAvailableSandboxBackend.mockResolvedValue('docker');
    mockListCacheImages.mockResolvedValue([]);
    mockRemoveCacheImage.mockResolvedValue(true);
    mockExistsSync.mockReturnValue(true);
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
      },
      {
        id: 'sha256:old',
        tag: 'rover-cache:older',
        createdAt: '2025-01-01T00:00:00Z',
        projectPath: '/home/user/project-a',
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

  it('removes images whose project path no longer exists', async () => {
    mockExistsSync.mockReturnValue(false);

    const images: CacheImageInfo[] = [
      {
        id: 'sha256:orphan',
        tag: 'rover-cache:orphaned',
        createdAt: '2025-01-01T00:00:00Z',
        projectPath: '/home/user/deleted-project',
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
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'sha256:remote',
          tag: 'rover-cache:remote1',
          createdAt: '2025-01-02T00:00:00Z',
          projectPath: '/home/user/project-a',
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
