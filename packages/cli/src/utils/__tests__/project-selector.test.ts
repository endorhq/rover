import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GlobalProject } from 'rover-schemas';

// Use vi.hoisted to create mock state that can be accessed from vi.mock factories
const { mockState } = vi.hoisted(() => {
  return {
    mockState: {
      projects: [] as GlobalProject[],
      autoCompleteResult: '' as string | Error,
    },
  };
});

// Mock ansi-colors to return plain strings
vi.mock('ansi-colors', () => ({
  default: {
    gray: (str: string) => str,
  },
}));

// Mock rover-core ProjectStore
vi.mock('rover-core', () => {
  return {
    ProjectStore: class MockProjectStore {
      list() {
        return mockState.projects;
      }
      get(id: string) {
        const project = mockState.projects.find(p => p.id === id);
        if (project) {
          return {
            id: project.id,
            path: project.path,
            name: project.repositoryName,
            repositoryName: project.repositoryName,
          };
        }
        return undefined;
      }
    },
  };
});

// Mock enquirer with AutoComplete - enquirer default export is an object with prompts
vi.mock('enquirer', () => {
  class MockAutoComplete {
    run() {
      if (mockState.autoCompleteResult instanceof Error) {
        return Promise.reject(mockState.autoCompleteResult);
      }
      return Promise.resolve(mockState.autoCompleteResult);
    }
  }

  // The default export of enquirer is an object that contains prompt classes
  const mockEnquirer = {
    AutoComplete: MockAutoComplete,
    autocomplete: MockAutoComplete,
    prompt: vi.fn(),
  };

  return {
    default: mockEnquirer,
    AutoComplete: MockAutoComplete,
    autocomplete: MockAutoComplete,
  };
});

describe('project-selector', () => {
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    // Reset modules to ensure fresh imports with mocks applied
    vi.resetModules();
    // Store original stdin.isTTY value
    originalIsTTY = process.stdin.isTTY;
    // Reset mocks
    vi.clearAllMocks();
    // Clear mock state
    mockState.projects = [];
    mockState.autoCompleteResult = '';
  });

  afterEach(() => {
    // Restore original stdin.isTTY value
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });
  });

  describe('promptProjectSelection', () => {
    it('returns null when no projects exist', async () => {
      mockState.projects = [];

      const { promptProjectSelection } = await import('../project-selector.js');
      const result = await promptProjectSelection();
      expect(result).toBeNull();
    });

    it('returns selected project on success', async () => {
      mockState.projects = [
        {
          id: 'project-1',
          path: '/home/user/project1',
          repositoryName: 'user/project1',
          languages: [],
          packageManagers: [],
          taskManagers: [],
          nextTaskId: 1,
        },
      ];

      // AutoComplete returns the display name (name field from choices)
      mockState.autoCompleteResult = 'user/project1 (/home/user/project1)';

      const { promptProjectSelection } = await import('../project-selector.js');
      const result = await promptProjectSelection();

      expect(result).not.toBeNull();
      expect(result?.id).toBe('project-1');
    });

    it('returns null when user cancels', async () => {
      mockState.projects = [
        {
          id: 'project-1',
          path: '/home/user/project1',
          repositoryName: 'user/project1',
          languages: [],
          packageManagers: [],
          taskManagers: [],
          nextTaskId: 1,
        },
      ];

      // Simulate user pressing Ctrl+C
      mockState.autoCompleteResult = new Error('cancelled');

      const { promptProjectSelection } = await import('../project-selector.js');
      const result = await promptProjectSelection();

      expect(result).toBeNull();
    });

    it('handles multiple projects', async () => {
      mockState.projects = [
        {
          id: 'project-1',
          path: '/home/user/project1',
          repositoryName: 'user/project1',
          languages: [],
          packageManagers: [],
          taskManagers: [],
          nextTaskId: 1,
        },
        {
          id: 'project-2',
          path: '/home/user/project2',
          repositoryName: 'org/project2',
          languages: [],
          packageManagers: [],
          taskManagers: [],
          nextTaskId: 1,
        },
      ];

      mockState.autoCompleteResult = 'org/project2 (/home/user/project2)';

      const { promptProjectSelection } = await import('../project-selector.js');
      const result = await promptProjectSelection();

      expect(result).not.toBeNull();
      expect(result?.id).toBe('project-2');
    });
  });
});
