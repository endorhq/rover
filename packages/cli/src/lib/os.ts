import { spawnSync as spawnSync_, SpawnSyncOptions, SpawnSyncReturns } from 'child_process';
import { execa, ExecaError, Options, Result } from 'execa';

export { SpawnSyncReturns };

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
    options?: Options
): Promise<Result> {
    try {
        return await execa(command, args, options);
    } catch (error) {
        if (error instanceof ExecaError) {
            if (error.exitCode !== 0) {
                throw `exit code for ${command} is ${error.exitCode}`;
            } else if (error.cause) {
                throw `failed to execute ${command}: ${error.cause}`;
            } else {
                throw `failed to execute ${command}`;
            }
        } else {
            throw `failed to execute ${command}`;
        }
    }
}