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

      // Check if the process is still alive (signal 0 = test only)
      try {
        process.kill(pid, 0);
        // Process is alive — another instance is running
        console.error(`\n  Error: Another Glassbox instance (PID ${pid}) is already running.`);
        console.error(`  Data directory: ${dataDir}`);
        console.error(`  Stop that instance first, or wait for it to exit.\n`);
        process.exit(1);
      } catch {
        // Process is dead — stale lock
        console.log(`  Removing stale lock from PID ${pid}`);
        rmSync(lockPath, { force: true });
      }
    } catch {
      // Corrupt lock file — remove it
      rmSync(lockPath, { force: true });
    }
  }

  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

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
