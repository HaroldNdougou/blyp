import { getDb } from "@/lib/db/sqlite";
import { getMessagesCacheOwnerPhone } from "@/lib/messagesCache";
import type { CommerceStamp } from "@/lib/receipts/commerceStampTypes";
import {
  stampFingerprint,
  stampScopeKey,
} from "@/lib/receipts/commerceStampTypes";

const STAMP_KEY_PREFIX = "receipt_stamp:";
const REGISTRY_KEY = "receipt_stamp_registry";

type RegistryEntry = { fingerprint: string; scope: string };

const ramByScope = new Map<string, CommerceStamp | null>();

function kvKey(scope: string): string {
  return `${STAMP_KEY_PREFIX}${scope}`;
}

async function readKv(phone: string, key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const row = await db.getFirstAsync<{ json: string }>(
    `SELECT json FROM kv_cache WHERE phone = ? AND key = ?`,
    phone,
    key,
  );
  return row?.json ?? null;
}

async function writeKv(phone: string, key: string, json: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    `INSERT OR REPLACE INTO kv_cache (phone, key, json) VALUES (?, ?, ?)`,
    phone,
    key,
    json,
  );
}

export function getCommerceStampCached(scope: string): CommerceStamp | null {
  if (!scope) return null;
  return ramByScope.get(scope) ?? null;
}

export async function loadCommerceStamp(
  userId: string,
  commerceId: string | null | undefined,
): Promise<CommerceStamp | null> {
  const scope = stampScopeKey(userId, commerceId);
  if (!scope) return null;
  const cached = ramByScope.get(scope);
  if (cached !== undefined) return cached;

  const phone = getMessagesCacheOwnerPhone();
  if (!phone) {
    ramByScope.set(scope, null);
    return null;
  }
  const raw = await readKv(phone, kvKey(scope));
  if (!raw) {
    ramByScope.set(scope, null);
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as CommerceStamp;
    if (!parsed?.line1?.trim()) {
      ramByScope.set(scope, null);
      return null;
    }
    ramByScope.set(scope, parsed);
    return parsed;
  } catch {
    ramByScope.set(scope, null);
    return null;
  }
}

export type SaveCommerceStampResult =
  | { ok: true; stamp: CommerceStamp }
  | { ok: false; reason: "DUPLICATE" | "INVALID" };

export async function saveCommerceStamp(
  userId: string,
  commerceId: string | null | undefined,
  stamp: CommerceStamp,
): Promise<SaveCommerceStampResult> {
  const scope = stampScopeKey(userId, commerceId);
  const line1 = stamp.line1.trim();
  if (!scope || !line1) return { ok: false, reason: "INVALID" };

  const next: CommerceStamp = {
    line1,
    line2: stamp.line2.trim(),
    shape: stamp.shape === "line" ? "line" : "circle",
    color: stamp.color === "blue" ? "blue" : "red",
    updatedAt: new Date().toISOString(),
  };
  const fp = stampFingerprint(next);

  const phone = getMessagesCacheOwnerPhone();
  if (!phone) return { ok: false, reason: "INVALID" };

  let registry: RegistryEntry[] = [];
  const regRaw = await readKv(phone, REGISTRY_KEY);
  if (regRaw) {
    try {
      registry = JSON.parse(regRaw) as RegistryEntry[];
    } catch {
      registry = [];
    }
  }
  const collision = registry.find(
    (e) => e.fingerprint === fp && e.scope !== scope,
  );
  if (collision) return { ok: false, reason: "DUPLICATE" };

  const without = registry.filter((e) => e.scope !== scope);
  without.push({ fingerprint: fp, scope });
  await writeKv(phone, REGISTRY_KEY, JSON.stringify(without));
  await writeKv(phone, kvKey(scope), JSON.stringify(next));
  ramByScope.set(scope, next);
  return { ok: true, stamp: next };
}
