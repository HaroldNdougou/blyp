import type { QuickPayRecipient } from "@/lib/pay/quickPayRecipient";

const ram = new Map<string, string>();

function digits9(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/\D/g, "")
    .slice(-9);
}

/** Résout BLYP-U-… via POST /contacts/blyp-lookup (cache RAM). */
export async function resolveAccountIdByPhone(
  token: string,
  phoneRaw: string,
): Promise<string | null> {
  const nine = digits9(phoneRaw);
  if (nine.length !== 9) return null;
  const cached = ram.get(nine);
  if (cached) return cached;
  const t = String(token ?? "").trim();
  if (!t) return null;
  try {
    const { lookupBlypPhones } = await import("@/lib/api/client");
    const res = await lookupBlypPhones(t, [nine]);
    const hit = res.items.find((i) => digits9(i.phone) === nine);
    const id = hit?.accountId?.trim().toUpperCase() ?? "";
    if (!hit?.onBlyp || !id.startsWith("BLYP-")) return null;
    ram.set(nine, id);
    return id;
  } catch {
    return null;
  }
}
