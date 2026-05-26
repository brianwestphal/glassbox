import { parentPort } from 'node:worker_threads';

import { ensureRenderInit, renderSvgToPng } from './svg-rasterize-render.js';

/**
 * Worker-thread entry for SVG rasterization.
 *
 * Rendering is synchronous WASM work that would otherwise freeze the HTTP
 * server's event loop for hundreds of milliseconds per image (seconds for
 * large/animated SVGs). Running it here keeps the main thread responsive.
 *
 * Protocol (managed by `svg-rasterize.ts`):
 *  - main → worker: `{ id, svg }`
 *  - worker → main: `{ type: 'ready' }` once initialized, then
 *                   `{ type: 'result', id, png }` or `{ type: 'error', id, message }`.
 */

if (!parentPort) {
  throw new Error('svg-rasterize-worker must be spawned as a worker thread');
}
const port = parentPort;

// Initialize WASM + fonts up front so a broken environment (missing wasm file,
// unsupported runtime) surfaces as a worker startup error — the manager then
// degrades to in-process rendering instead of failing every render request.
await ensureRenderInit();

async function handleMessage(msg: { id: number; svg: string }): Promise<void> {
  try {
    const png = await renderSvgToPng(msg.svg);
    port.postMessage({ type: 'result', id: msg.id, png });
  } catch (err) {
    port.postMessage({
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

port.on('message', (msg: { id: number; svg: string }) => void handleMessage(msg));

port.postMessage({ type: 'ready' });
