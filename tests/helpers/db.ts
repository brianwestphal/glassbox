/**
 * Test helper: provides a fresh in-memory PGLite database for each test suite.
 * Mocks `src/db/connection.ts` so all query functions use the test database.
 */
import { PGlite } from '@electric-sql/pglite';
import { vi } from 'vitest';
import { SCHEMA_CORE_SQL, SCHEMA_AI_SQL } from '../../src/db/ddl.js';

let testDb: PGlite | null = null;

/** Initialize a fresh in-memory PGLite with the full schema. Call in beforeAll(). */
export async function setupTestDb(): Promise<PGlite> {
  testDb = new PGlite();
  await testDb.waitReady;

  await testDb.exec(SCHEMA_CORE_SQL);
  await testDb.exec(SCHEMA_AI_SQL);

  return testDb;
}

/** Tear down the test database. Call in afterAll(). */
export async function teardownTestDb(): Promise<void> {
  if (testDb) {
    await testDb.close();
    testDb = null;
  }
}
