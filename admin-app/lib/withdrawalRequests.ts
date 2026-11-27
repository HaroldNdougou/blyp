import { api } from "./api";

export type WithdrawalRequestRow = {
  id: string;
  userId: string | null;
  kind: "deposit" | "withdrawal";
  name: string;
  phone: string;
  amountFcfa: number;
  summary: string;
  at: string;
  status: string;
};

const handledIds = new Set<string>();

export function markWithdrawalHandled(id: string) {
  handledIds.add(id);
}

export function isWithdrawalHandled(id: string) {
  return handledIds.has(id);
}

/** Même logique que le mail admin (UTC stocké → heure Cameroun). */
export function formatRequestWhen(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms + 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(
    d.getUTCMinutes(),
  )}`;
}

function parseAmount(lines: [string, string][] | undefined, summary: string) {
  const montant = lines?.find(([k]) => k === "Montant")?.[1];
  if (montant) {
    const n = parseInt(montant.replace(/[^\d]/g, ""), 10);
    if (n > 0) return n;
  }
  const m = summary.match(/([\d\s]{1,12})\s*F/i);
  if (m) {
    const n = parseInt(m[1].replace(/\s/g, ""), 10);
    if (n > 0) return n;
  }
  return 0;
}

function parseStatus(lines: [string, string][] | undefined) {
  return lines?.find(([k]) => k === "Statut")?.[1]?.trim() || "en attente";
}

export async function fetchWithdrawalRequests(): Promise<WithdrawalRequestRow[]> {
  const data = await api<{
    items: {
      requestId: string;
      userId?: string | null;
      kind?: string;
      name?: string;
      phone?: string;
      amountFcfa?: number;
      status?: string;
      createdAt?: string;
    }[];
  }>("/api/money-requests");

  return (data.items ?? [])
    .filter((e) => !isWithdrawalHandled(e.requestId))
    .map((e) => ({
      id: e.requestId,
      userId: e.userId ?? null,
      kind: (e.kind === "deposit" ? "deposit" : "withdrawal") as WithdrawalRequestRow["kind"],
      name: (e.name ?? "").trim() || "Client",
      phone: (e.phone ?? "").trim() || "—",
      amountFcfa: Math.floor(e.amountFcfa ?? 0),
      summary: e.kind === "deposit" ? "Recharge" : "Retrait",
      at: e.createdAt ?? "",
      status: e.status ?? "pending",
    }))
    .filter(
      (e) => e.userId && e.amountFcfa > 0 && (e.status === "pending" || !e.status),
    );
}