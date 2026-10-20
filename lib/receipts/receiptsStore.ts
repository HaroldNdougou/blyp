import type { MerchantReceipt, MerchantReceiptCategory } from "@/lib/receipts/types";
import { getDb, runDbWrite } from "@/lib/db/sqlite";
import { bumpReceiptsUnread } from "@/lib/receipts/receiptsUnread";
import FS from "@/lib/voice/fileSystem";

function newReceiptId(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return `rcpt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const MAX_ITEMS = 200;
const byAccount = new Map<string, MerchantReceipt[]>();

function sortItems(items: MerchantReceipt[]): MerchantReceipt[] {
  return [...items].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt)),
  );
}

function receiptDir(accountId: string) {
  return `${FS.documentDirectory}blyp-receipts/${accountId}/`;
}

async function ensureDir(accountId: string) {
  const dir = receiptDir(accountId);
  const info = await FS.getInfoAsync(dir);
  if (!info.exists) {
    await FS.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

function extFromFileName(fileName: string, contentType: string): string {
  const base = String(fileName ?? "").trim();
  const dot = base.lastIndexOf(".");
  if (dot > 0 && dot < base.length - 1) {
    return base.slice(dot).toLowerCase();
  }
  const ct = String(contentType ?? "").toLowerCase();
  if (ct.includes("pdf")) return ".pdf";
  if (ct.includes("png")) return ".png";
  return ".jpg";
}

async function persistFile(
  accountId: string,
  id: string,
  sourceUri: string,
  fileName: string,
  contentType: string,
): Promise<string> {
  const dir = await ensureDir(accountId);
  const dest = `${dir}${id}${extFromFileName(fileName, contentType)}`;
  await FS.copyAsync({ from: sourceUri, to: dest });
  return dest;
}

export function getReceiptsSnapshot(accountId: string): MerchantReceipt[] | null {
  const id = String(accountId ?? "").trim();
  if (!id) return null;
  const v = byAccount.get(id);
  return v !== undefined ? v : null;
}

export function setReceiptsSnapshot(
  accountId: string,
  items: MerchantReceipt[],
): void {
  const id = String(accountId ?? "").trim();
  if (!id) return;
  byAccount.set(id, sortItems(items).slice(0, MAX_ITEMS));
}

export async function hydrateReceiptsCache(accountId: string): Promise<void> {
  const id = String(accountId ?? "").trim();
  if (!id || byAccount.has(id)) return;
  const db = await getDb();
  if (!db) return;
  const rows = await db.getAllAsync<{
    id: string;
    accountId: string;
    name: string;
    merchantName: string | null;
    category: string;
    localUri: string;
    contentType: string;
    sizeBytes: number;
    createdAt: string;
  }>(
    `SELECT id, accountId, name, merchantName, category, localUri, contentType, sizeBytes, createdAt
     FROM merchant_receipts WHERE accountId = ? ORDER BY createdAt DESC LIMIT ?`,
    id,
    MAX_ITEMS,
  );
  const items = rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    name: r.name,
    merchantName: r.merchantName,
    category: (r.category as MerchantReceiptCategory) || "manual",
    localUri: r.localUri,
    contentType: r.contentType,
    sizeBytes: r.sizeBytes,
    createdAt: r.createdAt,
  }));
  byAccount.set(id, items);
}

function blypMoneyReceiptId(transferId: string): string {
  return `blyp-mt-${String(transferId ?? "").trim()}`;
}

/** Reçu Blyp généré à la récupération money — une entrée par transferId. */
export async function addBlypMerchantReceipt(input: {
  accountId: string;
  transferId: string;
  name: string;
  merchantName?: string | null;
  category?: MerchantReceiptCategory;
  localUri: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}): Promise<MerchantReceipt> {
  const accountId = String(input.accountId ?? "").trim();
  const transferId = String(input.transferId ?? "").trim();
  if (!accountId || !transferId) throw new Error("ACCOUNT_INVALID");
  const id = blypMoneyReceiptId(transferId);
  const prev = byAccount.get(accountId) ?? [];
  const existing = prev.find((r) => r.id === id);
  if (existing) return existing;

  const localUri = await persistFile(
    accountId,
    id,
    input.localUri,
    input.fileName,
    input.contentType,
  );
  const receipt: MerchantReceipt = {
    id,
    accountId,
    name: input.name.trim(),
    merchantName: input.merchantName?.trim() || null,
    category: input.category ?? "service",
    localUri,
    contentType: input.contentType,
    sizeBytes: Math.max(1, Math.floor(input.sizeBytes)),
    createdAt: new Date().toISOString(),
  };
  await runDbWrite(async (db) => {
    await db.runAsync(
      `INSERT OR REPLACE INTO merchant_receipts
        (accountId, id, name, merchantName, category, localUri, contentType, sizeBytes, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      receipt.accountId,
      receipt.id,
      receipt.name,
      receipt.merchantName,
      receipt.category,
      receipt.localUri,
      receipt.contentType,
      receipt.sizeBytes,
      receipt.createdAt,
    );
  });
  const next = sortItems([receipt, ...prev.filter((r) => r.id !== id)]).slice(
    0,
    MAX_ITEMS,
  );
  byAccount.set(accountId, next);
  bumpReceiptsUnread(accountId, receipt.id);
  return receipt;
}

export async function addMerchantReceipt(input: {
  accountId: string;
  name: string;
  merchantName?: string | null;
  category?: MerchantReceiptCategory;
  localUri: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}): Promise<MerchantReceipt> {
  const accountId = String(input.accountId ?? "").trim();
  if (!accountId) throw new Error("ACCOUNT_INVALID");
  const id = newReceiptId();
  const localUri = await persistFile(
    accountId,
    id,
    input.localUri,
    input.fileName,
    input.contentType,
  );
  const receipt: MerchantReceipt = {
    id,
    accountId,
    name: input.name.trim(),
    merchantName: input.merchantName?.trim() || null,
    category: input.category ?? "manual",
    localUri,
    contentType: input.contentType,
    sizeBytes: Math.max(1, Math.floor(input.sizeBytes)),
    createdAt: new Date().toISOString(),
  };
  await runDbWrite(async (db) => {
    await db.runAsync(
      `INSERT INTO merchant_receipts
        (accountId, id, name, merchantName, category, localUri, contentType, sizeBytes, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      receipt.accountId,
      receipt.id,
      receipt.name,
      receipt.merchantName,
      receipt.category,
      receipt.localUri,
      receipt.contentType,
      receipt.sizeBytes,
      receipt.createdAt,
    );
  });
  const prev = byAccount.get(accountId) ?? [];
  const next = sortItems([receipt, ...prev]).slice(0, MAX_ITEMS);
  byAccount.set(accountId, next);
  return receipt;
}

export async function deleteMerchantReceipt(
  accountId: string,
  receiptId: string,
): Promise<void> {
  const aid = String(accountId ?? "").trim();
  const rid = String(receiptId ?? "").trim();
  if (!aid || !rid) return;
  const prev = byAccount.get(aid) ?? [];
  const row = prev.find((r) => r.id === rid);
  await runDbWrite(async (db) => {
    await db.runAsync(
      `DELETE FROM merchant_receipts WHERE accountId = ? AND id = ?`,
      aid,
      rid,
    );
  });
  if (row?.localUri) {
    try {
      await FS.deleteAsync(row.localUri, { idempotent: true });
    } catch {
      /* ignore */
    }
  }
  byAccount.set(aid, prev.filter((r) => r.id !== rid));
}

export function clearReceiptsForAccount(accountId: string): void {
  const id = String(accountId ?? "").trim();
  if (!id) return;
  byAccount.delete(id);
  void runDbWrite(async (db) => {
    await db.runAsync(`DELETE FROM merchant_receipts WHERE accountId = ?`, id);
  });
}
