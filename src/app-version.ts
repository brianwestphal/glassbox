/**
 * The running Glassbox version, read from the packaged `package.json`.
 *
 * Deliberately lives at `src/` root rather than under `src/utils/`: it resolves
 * `package.json` as one directory up from its own module, which holds for both
 * `src/app-version.ts` in dev and the bundled `dist/cli.js` in a build. A copy
 * under `src/utils/` would be one level too deep in dev.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const VersionPayloadSchema = z.object({ version: z.string() });

/** The current version, or `0.0.0` when `package.json` can't be read. */
export function getCurrentVersion(): string {
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const raw: unknown = JSON.parse(readFileSync(join(dir, '..', 'package.json'), 'utf-8'));
    return VersionPayloadSchema.parse(raw).version;
  } catch {
    return '0.0.0';
  }
}
