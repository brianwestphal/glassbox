/**
 * Typed API for the retained pre-upgrade database backups (doc 9 §9.1a).
 *
 * The PostgreSQL major-version upgrade keeps a verified copy of the old cluster
 * and never removes it on its own — deleting a user's only fallback is not the
 * app's call to make. These endpoints are what let the user see that the copy
 * exists, how much space it holds, and reclaim it once they trust the upgrade.
 */
import { z } from 'zod';

import { apiCall, OkResponseSchema } from './_runner.js';

export const DatabaseBackupSchema = z.object({
  name: z.string(),
  path: z.string(),
  bytes: z.number(),
  createdAt: z.string().nullable(),
});
export type DatabaseBackup = z.infer<typeof DatabaseBackupSchema>;

export const ListBackupsRespSchema = z.object({
  backups: z.array(DatabaseBackupSchema),
});
export type ListBackupsResp = z.infer<typeof ListBackupsRespSchema>;

export async function listDatabaseBackups(): Promise<ListBackupsResp> {
  return apiCall(ListBackupsRespSchema, '/db-backups');
}

export const DeleteBackupRespSchema = OkResponseSchema;
export type DeleteBackupResp = z.infer<typeof DeleteBackupRespSchema>;

export async function deleteDatabaseBackup(name: string): Promise<DeleteBackupResp> {
  return apiCall(DeleteBackupRespSchema, `/db-backups/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}
