import type { Backend } from '@shared/types';
import { createCliDriver } from './cli';
import { createSdkDriver } from './sdk';
import type { RunDriver } from './types';

export type { RunDriver, RunHandle, StartArgs } from './types';
export { createCliDriver } from './cli';
export { createSdkDriver } from './sdk';

/** One instance per backend, created lazily and reused: neither driver holds state between
 *  runs (each `start()` call is self-contained), so sharing an instance across runs is safe. */
const cliDriver = createCliDriver();
const sdkDriver = createSdkDriver();

export function driverFor(backend: Backend): RunDriver {
  return backend === 'sdk' ? sdkDriver : cliDriver;
}
