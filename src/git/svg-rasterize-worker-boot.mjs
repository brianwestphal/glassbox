// Dev-mode bootstrap for the SVG rasterization worker.
//
// When the server runs from TypeScript source via tsx (`npm run dev`,
// `tauri:dev`), worker threads do NOT inherit tsx's ESM loader hooks, so a
// worker pointed straight at `svg-rasterize-worker.ts` fails with "Unknown
// file extension '.ts'". This plain-JS shim registers the tsx loader in the
// worker thread first, then imports the TypeScript worker.
//
// Production builds never use this file: tsup emits `svg-rasterize-worker.js`
// and the manager spawns that bundled artifact directly.
import { register } from 'tsx/esm/api';

register();
await import('./svg-rasterize-worker.ts');
