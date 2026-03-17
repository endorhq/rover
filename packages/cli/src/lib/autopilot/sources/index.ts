export type {
  PlatformSource,
  RepoInfo,
  EventKind,
  NormEvent,
  EventFetcher,
} from './types.js';
export {
  detectSource,
  detectSourceWithProbe,
  parseRepoInfo,
  getRepoInfo,
} from './detect.js';
export { GitHubFetcher } from './github.js';
export { GitLabFetcher } from './gitlab.js';
