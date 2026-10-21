import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let prepared = false;

/**
 * Use readable-stream's supported native Node backend before loading the game SDK.
 * DSH 0.2.1-rc.2 cannot route npm builtin-name subpaths such as process/.
 * Keep the environment change synchronous and restore it before any async import,
 * callback, child process or model/game operation. Never modify the host resolver.
 */
export function prepareDshNativeStreams() {
  if (prepared) return;
  const previous = process.env.READABLE_STREAM;
  try {
    process.env.READABLE_STREAM = 'disable';
    require('readable-stream');
    prepared = true;
  } finally {
    if (previous === undefined) delete process.env.READABLE_STREAM;
    else process.env.READABLE_STREAM = previous;
  }
}
