import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

let lockPath: string | null = null;

const LockFileSchema = z.object({ pid: z.number().int() });

export function acquireLock(dataDir: string): void {
  lockPath = join(dataDir, 'glassbox.lock');

  if (existsSync(lockPath)) {
    try {
      const raw: unknown = JSON.parse(readFileSync(lockPath, 'utf-8'));
      const contents = LockFileSchema.parse(raw);
      const pid = contents.pid;

      // Check if the process is still alive (signal 0 = test only). Only
      // ESRCH means "no such process": EPERM means the process EXISTS but is
      // owned by another user, so treating any throw as stale would clobber a
      // live instance's lock (GB-1085).
      try {
        process.kill(pid, 0);
        // Process is alive — another instance is running
        console.error(`\n  Error: Another Glassbox instance (PID ${pid}) is already running.`);
        console.error(`  Data directory: ${dataDir}`);
        console.error(`  Stop that instance first, or wait for it to exit.\n`);
        process.exit(1);
        return; // unreachable in production; keeps mocked-exit tests coherent
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
          console.error(`\n  Error: Another Glassbox instance (PID ${pid}) appears to be running (owned by another user).`);
          console.error(`  Data directory: ${dataDir}\n`);
          process.exit(1);
          return; // unreachable in production
        }
        // Process is dead — stale lock
        console.log(`  Removing stale lock from PID ${pid}`);
        rmSync(lockPath, { force: true });
      }
    } catch {
      // Corrupt lock file — remove it
      rmSync(lockPath, { force: true });
    }
  }

  // `wx` = exclusive create: if two launches race past the exists-check above,
  // exactly one wins the lock and the other exits cleanly (the old
  // existsSync→write pair let both through — TOCTOU, GB-1085).
  try {
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { flag: 'wx' });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      console.error(`\n  Error: Another Glassbox instance grabbed the lock first.`);
      console.error(`  Data directory: ${dataDir}\n`);
      process.exit(1);
      return; // unreachable in production
    }
    throw err;
  }

  const cleanup = () => { releaseLock(); };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
}

function releaseLock(): void {
  if (lockPath !== null) {
    try { rmSync(lockPath, { force: true }); } catch { /* shutting down */ }
    lockPath = null;
  }
}
