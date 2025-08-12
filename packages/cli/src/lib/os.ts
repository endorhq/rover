import { spawnSync as spawnSync_, SpawnSyncOptions, SpawnSyncReturns } from 'child_process';

export function spawnSync(
  command: string,
  args?: ReadonlyArray<string>,
  options?: SpawnSyncOptions
): SpawnSyncReturns<Buffer | string> {
    const res = spawnSync_(command, args, options);
    if (res.error) {
        throw `failed to execute ${command}: ${res.error}`;
    }
    return res;
}
