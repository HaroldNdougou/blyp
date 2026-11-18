import { api } from "./api";

export type WithdrawalRequestRow = {
  id: string;
  userId: string | null;
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
      id: string;
      type: string;
      userId?: string | null;
      name?: string;
      phone?: string;
      summary: string;
      at: string;
      lines?: [string, string][];
    }[];
  }>("/api/events?types=withdrawal&limit=80");

  return (data.items ?? [])
    .filter((e) => e.type === "withdrawal" && !isWithdrawalHandled(e.id))
    .map((e) => ({
      id: e.id,
      userId: e.userId ?? null,
      name: (e.name ?? "").trim() || "Client",
      phone: (e.phone ?? "").trim() || "—",
      amountFcfa: parseAmount(e.lines, e.summary),
      summary: e.summary,
      at: e.at,
      status: parseStatus(e.lines),
    }))
    .filter((e) => e.userId && e.amountFcfa > 0);
}