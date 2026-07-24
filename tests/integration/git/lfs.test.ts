/**
 * GB-1102 — Git LFS-tracked images, against a real git repository.
 *
 * An LFS-tracked file is stored as a three-line text pointer, so `git diff`
 * emits an ordinary text diff (no "Binary files … differ") and `git show
 * <ref>:<path>` hands back the pointer instead of the image. Glassbox rendered
 * such a PNG as a text diff of `oid sha256:…` with no image comparison at all.
 *
 * These tests use a **stand-in clean/smudge filter** rather than git-lfs itself:
 * it stores content in a side directory and emits a spec-shaped pointer, which
 * is the same contract from git's point of view. That keeps the test hermetic —
 * no git-lfs install, no network, no LFS server — while still exercising the
 * real thing the unit tests mock out, namely that `git cat-file --filters`
 * actually materializes content a plain `git show` cannot.
 */
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getFileDiffs } from '../../../src/git/diff.js';
import { getNewImage, getOldImage } from '../../../src/git/image.js';

let repo: string;
/** A tiny but genuine PNG (signature + IHDR), so the bytes are recognizable. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('IHDR-and-then-some-payload-bytes'),
]);
const PNG_V2 = Buffer.concat([PNG, Buffer.from('-v2')]);

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf-8' });
}

/** Write the stand-in LFS filter pair and register it for `*.png`. */
function installFakeLfsFilter(): void {
  const store = join(repo, '.fake-lfs');
  mkdirSync(store, { recursive: true });

  // The store path is baked into the scripts rather than passed by env: the
  // production code spawns git with a scrubbed environment, and git spawns the
  // filter, so an env var would not reliably survive the trip.
  const clean = join(repo, 'clean.cjs');
  writeFileSync(clean, `
    const { createHash } = require('crypto'); const fs = require('fs');
    const chunks = [];
    process.stdin.on('data', c => chunks.push(c)).on('end', () => {
      const buf = Buffer.concat(chunks);
      const oid = createHash('sha256').update(buf).digest('hex');
      fs.writeFileSync(${JSON.stringify(store)} + '/' + oid, buf);
      process.stdout.write('version https://git-lfs.github.com/spec/v1\\n' + 'oid sha256:' + oid + '\\n' + 'size ' + buf.length + '\\n');
    });
  `);

  const smudge = join(repo, 'smudge.cjs');
  writeFileSync(smudge, `
    const fs = require('fs');
    const chunks = [];
    process.stdin.on('data', c => chunks.push(c)).on('end', () => {
      const m = /oid sha256:([0-9a-f]{64})/.exec(Buffer.concat(chunks).toString('utf-8'));
      process.stdout.write(m === null ? Buffer.concat(chunks) : fs.readFileSync(${JSON.stringify(store)} + '/' + m[1]));
    });
  `);

  git(['config', 'filter.fakelfs.clean', `${process.execPath} ${clean}`]);
  git(['config', 'filter.fakelfs.smudge', `${process.execPath} ${smudge}`]);
  writeFileSync(join(repo, '.gitattributes'), '*.png filter=fakelfs -text\n');
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'gb-lfs-repo-'));
  git(['init', '-q', '--initial-branch=main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);

  installFakeLfsFilter();
  writeFileSync(join(repo, 'shot.png'), PNG);
  git(['add', '.']);
  git(['commit', '-qm', 'add lfs-tracked png']);

  // Modify it so there is an old/new pair to compare.
  writeFileSync(join(repo, 'shot.png'), PNG_V2);
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('Git LFS-tracked images', () => {
  it('stores a pointer, not the image (the premise of this bug)', () => {
    // Guards the fixture itself: if the filter silently stopped applying, every
    // assertion below would pass for the wrong reason.
    expect(git(['show', 'HEAD:shot.png'])).toContain('version https://git-lfs.github.com/spec/v1');
  });

  it('marks the diff binary so the image comparison renders', () => {
    const diffs = getFileDiffs({ type: 'uncommitted' }, repo);
    const shot = diffs.find(d => d.filePath === 'shot.png');
    expect(shot).toBeDefined();
    expect(shot!.isBinary).toBe(true);
    // The pointer text must not leak into the diff as reviewable content.
    expect(JSON.stringify(shot!.hunks)).not.toContain('git-lfs.github.com');
  });

  it('serves the real committed bytes for the old side', () => {
    const old = getOldImage({ type: 'uncommitted' }, 'shot.png', null, repo);
    expect(old).not.toBeNull();
    expect(old!.data.subarray(0, 8)).toEqual(PNG.subarray(0, 8)); // PNG signature
    expect(old!.data).toEqual(PNG);
  });

  it('serves the working-tree bytes for the new side', () => {
    const created = getNewImage({ type: 'uncommitted' }, 'shot.png', repo);
    expect(created).not.toBeNull();
    expect(created!.data).toEqual(PNG_V2);
  });

  it('returns null rather than pointer text when the LFS content is missing', () => {
    // Simulates a partial clone / LFS not installed: the smudge finds nothing
    // to substitute and hands the pointer straight back. Rendering that as an
    // image would produce a broken image; a missing one is the honest outcome.
    rmSync(join(repo, '.fake-lfs'), { recursive: true, force: true });
    mkdirSync(join(repo, '.fake-lfs'), { recursive: true });
    expect(getOldImage({ type: 'uncommitted' }, 'shot.png', null, repo)).toBeNull();
  });
});
