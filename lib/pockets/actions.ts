/**
 * Mutations poches — optimistes (UI au clic), réseau confirme, rollback si refus.
 */
import { InteractionManager } from "react-native";
import type { Pocket } from "@/lib/api/types";
import {
  getPocketsSnapshot,
  prependPocketTx,
  removePocketLocal,
  replacePocketTx,
  upsertPocket,
} from "@/lib/pockets/store";

function newKey(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return `pk-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

type Ctx = {
  token: string;
  phone: string;
  /** Disponible actuel (BALANCE perso). */
  balanceFcfa: number;
  updateBalance: (balanceFcfa: number) => void;
};

function syncLedgerLater(token: string, phone: string) {
  InteractionManager.runAfterInteractions(() => {
    void import("@/lib/sync/transactionsSync")
      .then((m) => m.syncTransactionsFromNetwork(token, phone))
      .catch(() => {});
  });
}

export async function movePocketFundsOptimistic(
  ctx: Ctx,
  pocket: Pocket,
  direction: "in" | "out",
  amount: number,
): Promise<void> {
  const { token, phone, balanceFcfa, updateBalance } = ctx;
  const delta = direction === "in" ? amount : -amount;
  const before = getPocketsSnapshot(phone).find((p) => p.id === pocket.id) ?? pocket;
  const tempId = `tmp-${Date.now()}`;

  upsertPocket(phone, { ...before, balanceFcfa: before.balanceFcfa + delta });
  updateBalance(balanceFcfa - delta);
  prependPocketTx(phone, {
    id: tempId,
    pocketId: pocket.id,
    direction,
    amountFcfa: amount,
    createdAt: new Date().toISOString(),
  });

  try {
    const api = await import("@/lib/api/client");
    const res = await api.movePocketFunds(
      token,
      pocket.id,
      direction,
      amount,
      newKey(),
    );
    if (res.pocket) upsertPocket(phone, res.pocket);
    updateBalance(res.balanceFcfa);
    replacePocketTx(phone, pocket.id, tempId, res.transaction);
    syncLedgerLater(token, phone);
  } catch (e) {
    const cur = getPocketsSnapshot(phone).find((p) => p.id === pocket.id);
    if (cur) upsertPocket(phone, { ...cur, balanceFcfa: cur.balanceFcfa - delta });
    updateBalance(balanceFcfa);
    replacePocketTx(phone, pocket.id, tempId, null);
    throw e;
  }
}

export async function createPocketOptimistic(
  ctx: Ctx,
  name: string,
  initialAmount: number,
): Promise<Pocket> {
  const { token, phone, balanceFcfa, updateBalance } = ctx;
  const tempId = `tmp-${Date.now()}`;
  const now = new Date().toISOString();
  upsertPocket(phone, {
    id: tempId,
    name,
    kind: "custom",
    balanceFcfa: initialAmount,
    createdAt: now,
    updatedAt: now,
  });
  if (initialAmount > 0) updateBalance(balanceFcfa - initialAmount);

  try {
    const api = await import("@/lib/api/client");
    const res = await api.createPocket(
      token,
      { name, initialAmount: initialAmount > 0 ? initialAmount : undefined },
      newKey(),
    );
    removePocketLocal(phone, tempId);
    if (!res.pocket) throw new Error("pocket missing");
    upsertPocket(phone, res.pocket);
    updateBalance(res.balanceFcfa);
    if (res.transaction) prependPocketTx(phone, res.transaction);
    if (initialAmount > 0) syncLedgerLater(token, phone);
    return res.pocket;
  } catch (e) {
    removePocketLocal(phone, tempId);
    if (initialAmount > 0) updateBalance(balanceFcfa);
    throw e;
  }
}

export async function renamePocketOptimistic(
  ctx: Pick<Ctx, "token" | "phone">,
  pocket: Pocket,
  name: string,
): Promise<void> {
  const { token, phone } = ctx;
  upsertPocket(phone, { ...pocket, name });
  try {
    const api = await import("@/lib/api/client");
    const res = await api.renamePocket(token, pocket.id, name);
    if (res.pocket) upsertPocket(phone, res.pocket);
  } catch (e) {
    upsertPocket(phone, pocket);
    throw e;
  }
}

export async function deletePocketOptimistic(
  ctx: Ctx,
  pocket: Pocket,
): Promise<void> {
  const { token, phone, balanceFcfa, updateBalance } = ctx;
  removePocketLocal(phone, pocket.id);
  if (pocket.balanceFcfa > 0) updateBalance(balanceFcfa + pocket.balanceFcfa);
  try {
    const api = await import("@/lib/api/client");
    const res = await api.deletePocket(token, pocket.id);
    updateBalance(res.balanceFcfa);
    if (pocket.balanceFcfa > 0) syncLedgerLater(token, phone);
  } catch (e) {
    upsertPocket(phone, pocket);
    updateBalance(balanceFcfa);
    throw e;
  }
}
