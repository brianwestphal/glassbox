import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the public rasterization facade in `svg-rasterize.ts`.
 *
 * The point of this module is that `rasterizeSvg` offloads the blocking WASM
 * render to a worker thread (so the HTTP server's event loop stays responsive)
 * and only renders in-process when a worker cannot start. These tests stub the
 * worker and the in-process render core to assert that offloading / fallback
 * routing happens correctly — the render math itself is covered by
 * `svg-rasterize-render.test.ts`.
 */

// A controllable fake Worker. Tests drive it by calling `.emit(...)` to
// simulate the messages a real worker thread would post back.
const hoisted = vi.hoisted(() => {
  const state = { instances: [] as FakeWorker[], ctorThrows: false };

  class FakeWorker {
    url: unknown;
    listeners: Record<string, ((...args: any[]) => void)[]> = {};
    postMessage = vi.fn();
    terminate = vi.fn();
    removeAllListeners = vi.fn(function (this: FakeWorker) {
      this.listeners = {};
      return this;
    });

    constructor(url: unknown) {
      if (state.ctorThrows) throw new Error('cannot spawn worker thread');
      this.url = url;
      state.instances.push(this);
    }

    on(event: string, cb: (...args: any[]) => void) {
      (this.listeners[event] ||= []).push(cb);
      return this;
    }

    emit(event: string, ...args: any[]) {
      for (const cb of [...(this.listeners[event] ?? [])]) cb(...args);
    }
  }

  return { state, FakeWorker };
});

vi.mock('node:worker_threads', () => ({ Worker: hoisted.FakeWorker }));

// Keep the real pure helpers (re-exported by the facade) but stub the blocking
// render core so the in-process fallback path is observable and instant.
vi.mock('../../../src/git/svg-rasterize-render.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/git/svg-rasterize-render.js')>();
  return {
    ...actual,
    renderSvgToPng: vi.fn(async () => Buffer.from('in-process-fallback')),
  };
});

type FakeWorker = InstanceType<typeof hoisted.FakeWorker>;

interface LoadedManager {
  rasterizeSvg: (buf: Buffer) => Promise<Buffer>;
  renderSvgToPng: Mock;
  instances: FakeWorker[];
}

/** Fresh manager per test — the facade keeps worker state at module scope. */
async function freshManager(): Promise<LoadedManager> {
  vi.resetModules();
  vi.clearAllMocks(); // reset call history (mock instances survive resetModules)
  hoisted.state.instances.length = 0;
  hoisted.state.ctorThrows = false;
  const facade = await import('../../../src/git/svg-rasterize.js');
  const core = await import('../../../src/git/svg-rasterize-render.js');
  return {
    rasterizeSvg: facade.rasterizeSvg,
    renderSvgToPng: core.renderSvgToPng as unknown as Mock,
    instances: hoisted.state.instances,
  };
}

describe('rasterizeSvg — worker offloading', () => {
  it('offloads rendering to a worker instead of running it in-process', async () => {
    const { rasterizeSvg, renderSvgToPng, instances } = await freshManager();

    const p = rasterizeSvg(Buffer.from('<svg width="10" height="10"/>'));
    expect(instances).toHaveLength(1);
    const worker = instances[0];

    // The blocking render must NOT happen on the main thread.
    expect(renderSvgToPng).not.toHaveBeenCalled();
    expect(worker.postMessage).toHaveBeenCalledWith({ id: 0, svg: '<svg width="10" height="10"/>' });

    worker.emit('message', { type: 'ready' });
    worker.emit('message', { type: 'result', id: 0, png: new Uint8Array([1, 2, 3]) });

    await expect(p).resolves.toEqual(Buffer.from([1, 2, 3]));
  });

  it('reuses a single worker across calls', async () => {
    const { rasterizeSvg, instances } = await freshManager();

    void rasterizeSvg(Buffer.from('<svg/>'));
    void rasterizeSvg(Buffer.from('<svg/>'));

    expect(instances).toHaveLength(1);
    expect(instances[0].postMessage).toHaveBeenCalledTimes(2);
  });

  it('rejects when the worker reports a per-render error', async () => {
    const { rasterizeSvg, instances } = await freshManager();

    const p = rasterizeSvg(Buffer.from('<svg/>'));
    instances[0].emit('message', { type: 'ready' });
    instances[0].emit('message', { type: 'error', id: 0, message: 'bad svg' });

    await expect(p).rejects.toThrow('bad svg');
  });
});

describe('rasterizeSvg — in-process fallback', () => {
  it('renders in-process when a worker cannot be spawned', async () => {
    const { rasterizeSvg, renderSvgToPng, instances } = await freshManager();
    hoisted.state.ctorThrows = true;

    const result = await rasterizeSvg(Buffer.from('<svg width="5" height="5"/>'));

    expect(instances).toHaveLength(0);
    expect(renderSvgToPng).toHaveBeenCalledWith('<svg width="5" height="5"/>');
    expect(result).toEqual(Buffer.from('in-process-fallback'));
  });

  it('falls back to in-process rendering when the worker fails to start', async () => {
    const { rasterizeSvg, renderSvgToPng, instances } = await freshManager();

    const p = rasterizeSvg(Buffer.from('<svg/>'));
    // Worker errors before ever signalling 'ready' (e.g. missing artifact).
    instances[0].emit('error', new Error('module not found'));

    await expect(p).resolves.toEqual(Buffer.from('in-process-fallback'));
    expect(renderSvgToPng).toHaveBeenCalledTimes(1);

    // Subsequent calls skip the worker entirely.
    await rasterizeSvg(Buffer.from('<svg/>'));
    expect(instances).toHaveLength(1); // no respawn
    expect(renderSvgToPng).toHaveBeenCalledTimes(2);
  });

  it('rejects in-flight jobs and respawns after a mid-flight crash', async () => {
    const { rasterizeSvg, instances } = await freshManager();

    const p = rasterizeSvg(Buffer.from('<svg/>'));
    instances[0].emit('message', { type: 'ready' });
    instances[0].emit('error', new Error('worker crashed'));

    await expect(p).rejects.toThrow('worker crashed');

    // A healthy worker had started, so the next call respawns rather than
    // permanently falling back.
    void rasterizeSvg(Buffer.from('<svg/>'));
    expect(instances).toHaveLength(2);
  });
});

describe('re-exported pure helpers', () => {
  it('re-exports the real parseSvgDimensions and svgUsesExternalFonts', async () => {
    vi.resetModules();
    const { parseSvgDimensions, svgUsesExternalFonts } = await import('../../../src/git/svg-rasterize.js');
    expect(parseSvgDimensions('<svg width="40" height="20"/>')).toEqual({ width: 40, height: 20 });
    expect(svgUsesExternalFonts(Buffer.from('<svg><text>hi</text></svg>'))).toBe(true);
    expect(svgUsesExternalFonts(Buffer.from('<svg><rect/></svg>'))).toBe(false);
  });
});
