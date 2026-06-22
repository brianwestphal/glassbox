/**
 * Integration tests for the attachment endpoints (doc 25): upload (multipart) →
 * list → serve bytes → list-all → quicklook → delete. Uses an in-memory PGLite
 * and Hono's `app.request()` (no real HTTP server). `openOS` is mocked so the
 * quicklook test doesn't spawn a real OS process.
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCHEMA_CORE_SQL, SCHEMA_AI_SQL } from '../../../src/db/schema.js';
import type { AppEnv } from '../../../src/types.js';

let testDb: PGlite;
const REVIEW_ID = 'att-review-1';
const DATA_DIR = mkdtempSync(join(tmpdir(), 'glassbox-att-'));

vi.mock('../../../src/db/connection.js', () => ({
  getDb: async () => testDb,
  getDataDir: () => DATA_DIR,
}));

const openOS = vi.fn();
vi.mock('../../../src/utils/openOS.js', () => ({ openOS: (...args: unknown[]) => openOS(...args) }));

// Imported after the mocks (vi.mock is hoisted).
import { attachmentsRoutes } from '../../../src/routes/api/attachments.js';

function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('reviewId', REVIEW_ID);
    c.set('repoRoot', '/tmp/repo');
    await next();
  });
  app.route('/', attachmentsRoutes);
  return app;
}

const app = createApp();
const ANNOTATION_ID = 'ann-1';

async function seedAnnotation(): Promise<void> {
  await testDb.exec(`
    INSERT INTO reviews (id, repo_path, repo_name, mode, mode_args, status)
      VALUES ('${REVIEW_ID}', '/tmp/repo', 'repo', 'demo', '', 'in_progress');
    INSERT INTO review_files (id, review_id, file_path, status, diff_data)
      VALUES ('rf-1', '${REVIEW_ID}', 'src/foo.ts', 'pending', '{}');
    INSERT INTO annotations (id, review_file_id, line_number, side, category, content)
      VALUES ('${ANNOTATION_ID}', 'rf-1', 5, 'new', 'bug', 'look here');
  `);
}

function fileForm(name: string, content: string, type = 'text/plain'): FormData {
  const form = new FormData();
  form.append('file', new File([content], name, { type }));
  return form;
}

beforeAll(async () => {
  testDb = new PGlite();
  await testDb.waitReady;
  await testDb.exec(SCHEMA_CORE_SQL);
  await testDb.exec(SCHEMA_AI_SQL);
});

afterAll(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  openOS.mockClear();
  await testDb.exec('DELETE FROM attachments; DELETE FROM annotations; DELETE FROM review_files; DELETE FROM reviews;');
  await seedAnnotation();
});

describe('attachment routes (doc 25)', () => {
  it('uploads, lists, serves bytes, and deletes an attachment', async () => {
    // Upload
    const up = await app.request(`/annotations/${ANNOTATION_ID}/attachments`, {
      method: 'POST',
      body: fileForm('notes.txt', 'hello world'),
    });
    expect(up.status).toBe(200);
    const att = await up.json();
    expect(att.original_filename).toBe('notes.txt');
    expect(att.mime_type).toBe('text/plain');
    expect(att.size).toBe('hello world'.length);
    expect(existsSync(att.stored_path)).toBe(true);

    // List for the annotation
    const list = await (await app.request(`/annotations/${ANNOTATION_ID}/attachments`)).json();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(att.id);

    // List-all for the review
    const all = await (await app.request('/attachments/all')).json();
    expect(all).toHaveLength(1);
    expect(all[0]).not.toHaveProperty('file_path'); // join columns stripped

    // Serve the raw bytes
    const raw = await app.request(`/attachments/${att.id}/raw`);
    expect(raw.status).toBe(200);
    expect(raw.headers.get('Content-Type')).toBe('text/plain');
    expect(await raw.text()).toBe('hello world');

    // Delete — row gone, file gone
    const del = await app.request(`/attachments/${att.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(existsSync(att.stored_path)).toBe(false);
    expect(await (await app.request(`/annotations/${ANNOTATION_ID}/attachments`)).json()).toHaveLength(0);
  });

  it('rejects an upload to a missing annotation', async () => {
    const res = await app.request('/annotations/nope/attachments', { method: 'POST', body: fileForm('a.txt', 'x') });
    expect(res.status).toBe(404);
  });

  it('rejects an upload with no file field', async () => {
    const res = await app.request(`/annotations/${ANNOTATION_ID}/attachments`, { method: 'POST', body: new FormData() });
    expect(res.status).toBe(400);
  });

  it('serves 404 for an unknown attachment id', async () => {
    expect((await app.request('/attachments/nope/raw')).status).toBe(404);
  });

  it('quicklook shells out to the OS opener for an existing attachment', async () => {
    const up = await app.request(`/annotations/${ANNOTATION_ID}/attachments`, { method: 'POST', body: fileForm('s.png', 'PNGDATA', 'image/png') });
    const att = await up.json();
    const ql = await app.request(`/attachments/${att.id}/quicklook`, { method: 'POST' });
    expect(ql.status).toBe(200);
    expect(openOS).toHaveBeenCalledWith(att.stored_path, 'quicklook');
  });

  it('quicklook 404s for an unknown attachment', async () => {
    const res = await app.request('/attachments/nope/quicklook', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(openOS).not.toHaveBeenCalled();
  });
});
