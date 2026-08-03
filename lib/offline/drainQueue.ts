import {
  bumpOfflineOpAttempt,
  listOfflineOps,
  removeOfflineOp,
  readPayPin,
} from "@/lib/offline/queue";
import { syncTransactionsFromNetwork } from "@/lib/sync/transactionsSync";

const MAX_ATTEMPTS = 5;

/**
 * Rejoue la file offline (point 4). Best effort, silencieux.
 */
export async function drainOfflineQueue(opts: {
  token: string;
  phone: string;
}): Promise<void> {
  const ops = await listOfflineOps();
  for (const op of ops) {
    if (op.attempts >= MAX_ATTEMPTS) {
      await removeOfflineOp(op.id);
      continue;
    }
    try {
      if (op.type === "pay") {
        const pin = await readPayPin(op.id);
        if (!pin) {
          await removeOfflineOp(op.id);
          continue;
        }
        const { pay } = await import("@/lib/api/client");
        const p = op.payload;
        await pay(
          opts.token,
          Number(p.amountFcfa),
          String(p.recipientName ?? ""),
          p.recipientPhone != null ? String(p.recipientPhone) : null,
          pin,
        );
        await removeOfflineOp(op.id);
        await syncTransactionsFromNetwork(opts.token, opts.phone);
      } else if (op.type === "deposit_refresh") {
        await syncTransactionsFromNetwork(opts.token, opts.phone);
        await removeOfflineOp(op.id);
      } else {
        await removeOfflineOp(op.id);
      }
    } catch {
      await bumpOfflineOpAttempt(op.id);
    }
  }
}
