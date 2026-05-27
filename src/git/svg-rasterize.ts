import { Worker } from 'node:worker_threads';

import { renderSvgToPng } from './svg-rasterize-render.js';

// Pure helpers (no WASM) live in the render core; re-export them so callers
// that only need dimension parsing / font detection don't pull in the worker.
export { parseSvgDimensions, svgUsesExternalFonts } from './svg-rasterize-render.js';

/**
 * Public rasterization API.
 *
 * `renderSvgToPng` is synchronous CPU-bound WASM work that can block the event
 * loop for hundreds of milliseconds (seconds for large/animated SVGs). To keep
 * the HTTP server responsive while a diff image is rendered, `rasterizeSvg`
 * offloads the work to a long-lived worker thread and only renders in-process
 * as a fallback when a worker cannot be started.
 *
 * A render that exceeds {@link RENDER_TIMEOUT_MS} is treated as pathological
 * (e.g. a huge animated SVG resvg can't handle). Because a synchronous WASM
 * call can't be interrupted from inside the thread, the only way to abort it is
 * to terminate the worker — so on timeout we kill it, fail that render, and
 * re-queue any jobs that were waiting behind it on a fresh worker.
 */

export const RENDER_TIMEOUT_MS = 15_000;

type WorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; png: Uint8Array }
  | { type: 'error'; id: number; message: string };

interface PendingJob {
  svg: string;
  resolve: (png: Buffer) => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let workerReady = false;
// Set once a worker fails to start; from then on we render in-process so the
// feature keeps working even if the worker artifact is missing or unsupported.
let workerDisabled = false;
let nextJobId = 0;
const pending = new Map<number, PendingJob>();

/**
 * Resolve the worker entry. In dev (running TypeScript source via tsx) we point
 * at a plain-JS bootstrap that registers the tsx loader before importing the
 * `.ts` worker; in a production build the bundled `svg-rasterize-worker.js`
 * sits next to the server bundle and is spawned directly.
 */
function resolveWorkerUrl(): URL {
  return import.meta.url.endsWith('.ts')
    ? new URL('./svg-rasterize-worker-boot.mjs', import.meta.url)
    : new URL('./svg-rasterize-worker.js', import.meta.url);
}

function clearJobTimer(job: PendingJob): void {
  if (job.timer !== undefined) clearTimeout(job.timer);
}

/** Run every queued job in-process. Used when the worker can't start. */
function fallbackAllPending(): void {
  for (const [id, job] of pending) {
    pending.delete(id);
    clearJobTimer(job);
    renderSvgToPng(job.svg).then(job.resolve, job.reject);
  }
}

/** Reject every queued job. Used when a running worker crashes mid-flight. */
function rejectAllPending(err: Error): void {
  for (const [id, job] of pending) {
    pending.delete(id);
    clearJobTimer(job);
    job.reject(err);
  }
}

function disposeWorker(): void {
  if (worker) {
    worker.removeAllListeners();
    void worker.terminate();
  }
  worker = null;
  workerReady = false;
}

/**
 * A render took too long. Kill the worker it's stuck in, fail that render, and
 * re-queue the jobs that were waiting behind it onto a fresh worker.
 */
function onJobTimeout(id: number): void {
  const job = pending.get(id);
  if (!job) return;
  pending.delete(id);
  clearJobTimer(job);

  // Grab the jobs queued behind the stuck one before we tear the worker down.
  const requeue = [...pending.values()];
  pending.clear();
  for (const r of requeue) clearJobTimer(r);
  disposeWorker();

  job.reject(new Error(`SVG rasterization timed out after ${RENDER_TIMEOUT_MS} ms`));

  for (const r of requeue) submit(r);
}

function getWorker(): Worker | null {
  if (workerDisabled) return null;
  if (worker) return worker;

  let spawned: Worker;
  try {
    spawned = new Worker(resolveWorkerUrl());
  } catch {
    // Runtime can't create worker threads at all — never try again.
    workerDisabled = true;
    return null;
  }

  spawned.on('message', (msg: WorkerResponse) => {
    if (msg.type === 'ready') {
      workerReady = true;
      return;
    }
    const job = pending.get(msg.id);
    if (!job) return;
    pending.delete(msg.id);
    clearJobTimer(job);
    if (msg.type === 'result') job.resolve(Buffer.from(msg.png));
    else job.reject(new Error(msg.message));
  });

  const handleFailure = (err: Error) => {
    const startupFailure = !workerReady;
    disposeWorker();
    if (startupFailure) {
      // Worker never finished starting (missing artifact, init crash, …).
      // Disable it permanently and serve the queued jobs in-process.
      workerDisabled = true;
      fallbackAllPending();
    } else {
      // Crash after a healthy start: fail in-flight jobs; the next call
      // respawns a fresh worker.
      rejectAllPending(err);
    }
  };

  spawned.on('error', handleFailure);
  spawned.on('exit', (code) => {
    if (code !== 0) handleFailure(new Error(`SVG rasterization worker exited with code ${code}`));
  });

  worker = spawned;
  return spawned;
}

/** Send one job to the worker (or render in-process if no worker is available). */
function submit(job: PendingJob): void {
  const activeWorker = getWorker();
  if (!activeWorker) {
    renderSvgToPng(job.svg).then(job.resolve, job.reject);
    return;
  }
  const id = nextJobId++;
  job.timer = setTimeout(() => { onJobTimeout(id); }, RENDER_TIMEOUT_MS);
  pending.set(id, job);
  activeWorker.postMessage({ id, svg: job.svg });
}

/** Rasterize an SVG buffer to a PNG buffer, off the main thread when possible. */
export async function rasterizeSvg(svgData: Buffer): Promise<Buffer> {
  const svg = svgData.toString('utf-8');
  return new Promise<Buffer>((resolve, reject) => {
    submit({ svg, resolve, reject });
  });
}
