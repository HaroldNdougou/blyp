import { getDb, runDbWrite } from "@/lib/db/sqlite";

const KV_KEY = "chat:recentEmojis";
const MAX = 40;

let ownerPhone: string | null = null;
let recent: string[] = [];
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function bindRecentEmojiOwner(phone: string | null): void {
  const next = String(phone ?? "").trim() || null;
  if (next === ownerPhone) return;
  ownerPhone = next;
  recent = [];
  hydrated = false;
  if (next) void hydrateRecentChatEmojis(next);
  emit();
}

export function subscribeRecentChatEmojis(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getRecentChatEmojis(): string[] {
  return recent;
}

export function pushRecentChatEmoji(emoji: string): void {
  const ch = String(emoji ?? "").trim();
  if (!ch) return;
  recent = [ch, ...recent.filter((e) => e !== ch)].slice(0, MAX);
  emit();
  const phone = ownerPhone;
  if (phone) {
    void runDbWrite((db) =>
      db.runAsync(
        `INSERT OR REPLACE INTO kv_cache (phone, key, json) VALUES (?, ?, ?)`,
        phone,
        KV_KEY,
        JSON.stringify(recent),
      ),
    ).catch(() => {});
  }
}

export async function hydrateRecentChatEmojis(phone: string): Promise<void> {
  const p = String(phone ?? "").trim();
  if (!p || (hydrated && ownerPhone === p)) return;
  ownerPhone = p;
  const db = await getDb();
  if (!db) {
    hydrated = true;
    return;
  }
  try {
    const row = await db.getFirstAsync<{ json: string }>(
      `SELECT json FROM kv_cache WHERE phone = ? AND key = ?`,
      p,
      KV_KEY,
    );
    if (row?.json) {
      const parsed = JSON.parse(row.json) as unknown;
      if (Array.isArray(parsed)) {
        recent = parsed
          .map((e) => String(e ?? "").trim())
          .filter(Boolean)
          .slice(0, MAX);
      }
    }
  } catch {
    /* garde RAM */
  }
  hydrated = true;
  emit();
}
