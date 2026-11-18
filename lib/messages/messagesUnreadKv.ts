import { runDbWrite } from "@/lib/db/sqlite";

const KV_KEY = "messages_unread_total";

export async function persistMessagesUnreadTotal(
  accountId: string,
  total: number,
): Promise<void> {
  const id = String(accountId ?? "").trim();
  if (!id) return;
  const n = Math.max(0, Math.floor(Number(total) || 0));
  await runDbWrite(async (db) => {
    await db.runAsync(
      `INSERT OR REPLACE INTO kv_cache (phone, key, json) VALUES (?, ?, ?)`,
      id,
      KV_KEY,
      JSON.stringify({ total: n }),
    );
  }).catch(() => {});
}
