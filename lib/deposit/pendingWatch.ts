/** Dépôt MoMo initié depuis la feuille — Pay continue le poll en fond. */

export type PendingDepositWatch = {
  token: string;
  depositIntentId: string;
  amountFcfa: number;
};

let pending: PendingDepositWatch | null = null;

export function armPendingDepositWatch(w: PendingDepositWatch): void {
  pending = w;
}

export function takePendingDepositWatch(): PendingDepositWatch | null {
  const w = pending;
  pending = null;
  return w;
}
