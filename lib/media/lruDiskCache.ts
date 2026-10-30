/**
 * Cache disque chat (image / voix / doc) — budget global + éviction LRU.
 * S3 reste source de vérité ; le téléphone garde une fenêtre glissante.
 */
import FS from "@/lib/voice/fileSystemLegacy";
import { runDbRead, runDbWrite } from "@/lib/db/sqlite";

/** ~512 Mo — Redmi / usage quotidien (ajuster via env dev si besoin). */
export const MEDIA_DISK_CACHE_BUDGET_BYTES = 512 * 1024 * 1024;

export type MediaCacheNamespace =
  | "image"
  | "voice"
  | "doc"
  | "doc_thumb_remote"
  | "doc_thumb_local";

const nowMs = () => Date.now();

async function fileSizeBytes(uri: string): Promise<number> {
  try {
    const info = await FS.getInfoAsync(uri);
    if (!info.exists) return 0;
    const size = (info as { size?: number }).size;
    return typeof size === "number" && size > 0 ? size : 0;
  } catch {
    return 0;
  }
}

async function deleteFileQuiet(uri: string): Promise<void> {
  try {
    await FS.deleteAsync(uri, { idempotent: true });
  } catch {
    /* ignore */
  }
}

async function totalIndexedBytes(): Promise<number> {
  const row = await runDbRead(async (db) =>
    db.getFirstAsync<{ n: number }>(
      `SELECT COALESCE(SUM(size_bytes), 0) AS n FROM media_disk_lru`,
    ),
  );
  return row?.n ?? 0;
}

async function evictUntilUnderBudget(): Promise<void> {
  let total = await totalIndexedBytes();
  if (total <= MEDIA_DISK_CACHE_BUDGET_BYTES) return;

  await runDbWrite(async (db) => {
    const rows = await db.getAllAsync<{ path: string; size_bytes: number }>(
      `SELECT path, size_bytes FROM media_disk_lru ORDER BY last_access ASC LIMIT 48`,
    );
    for (const row of rows) {
      if (total <= MEDIA_DISK_CACHE_BUDGET_BYTES) break;
      await deleteFileQuiet(row.path);
      await db.runAsync(`DELETE FROM media_disk_lru WHERE path = ?`, row.path);
      total -= row.size_bytes;
    }
  });
}

/** Lecture cache — remonte l’entrée en tête LRU. */
export function noteMediaCacheHit(fileUri: string): void {
  const path = String(fileUri ?? "").trim();
  if (!path) return;
  void runDbWrite(async (db) => {
    await db.runAsync(
      `UPDATE media_disk_lru SET last_access = ? WHERE path = ?`,
      nowMs(),
      path,
    );
  });
}

/** Après copy/download — indexe + éviction si dépassement budget. */
export async function noteMediaCacheWrite(
  fileUri: string,
  namespace: MediaCacheNamespace,
): Promise<void> {
  const path = String(fileUri ?? "").trim();
  if (!path) return;
  const size = await fileSizeBytes(path);
  if (size <= 0) return;

  await runDbWrite(async (db) => {
    await db.runAsync(
      `INSERT INTO media_disk_lru(path, namespace, size_bytes, last_access)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         namespace = excluded.namespace,
         size_bytes = excluded.size_bytes,
         last_access = excluded.last_access`,
      path,
      namespace,
      size,
      nowMs(),
    );
  });

  await evictUntilUnderBudget();
}

/** Au cold start (release) — purge si index incohérent avec le budget. */
export function trimMediaDiskCacheIfNeeded(): void {
  void evictUntilUnderBudget();
}
