import { spawnSync as spawnSync_, spawn as spawn_, SpawnSyncOptions, SpawnSyncReturns } from 'child_process';

export function spawnSync(
    command: string,
    args?: ReadonlyArray<string>,
    options?: SpawnSyncOptions
): SpawnSyncReturns<Buffer | string> {
    const res = spawnSync_(command, args, options);
    if (res.error) {
        throw `failed to execute ${command}: ${res.error}`;
    } else if (res.status !== 0) {
        throw `exit code for ${command} is ${res.status}`;
    }
    return res;
}

export async function spawn(
    command: string,
    args?: ReadonlyArray<string>,
    options?: SpawnSyncOptions
): Promise<SpawnSyncReturns<Buffer | string>> {
    const res = await spawn(command, args, options);
    if (res.error) {
        throw `failed to execute ${command}: ${res.error}`;
    } else if (res.status !== 0) {
        throw `exit code for ${command} is ${res.status}`;
    }
    return res;
}
