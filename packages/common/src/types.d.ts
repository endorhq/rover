import {
  Options,
  SyncOptions,
} from "execa";

export interface LaunchOptions {
  command: string;
  args?: ReadonlyArray<string>;
  options?: Options;
};

export interface LaunchSyncOptions {
  command: string;
  args?: ReadonlyArray<string>;
  options?: SyncOptions;
};