import type { Conversation } from "@/lib/api/types";
import { getRegularRecipients } from "@/lib/pay/regularRecipients";

function phoneKey(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D/g, "").slice(-9);
}

export function conversationForPhone(
  conversations: readonly Conversation[],
  phone: string,
): Conversation | undefined {
  const pk = phoneKey(phone);
  if (!pk) return undefined;
  return conversations.find((c) => phoneKey(c.peerPhone) === pk);
}

function matchesSearch(c: Conversation, q: string): boolean {
  if (!q) return true;
  const name = String(c.peerName ?? "").toLowerCase();
  const phone = String(c.peerPhone ?? "").toLowerCase();
  return name.includes(q) || phone.includes(q);
}

export type ForwardPickerSections = {
  frequent: Conversation[];
  recent: Conversation[];
};

/** Sections type WhatsApp — contacts fréquents + discussions récentes. */
export function buildForwardPickerSections(
  conversations: readonly Conversation[],
  searchQuery: string,
): ForwardPickerSections {
  const q = searchQuery.trim().toLowerCase();
  const filtered = conversations.filter((c) => matchesSearch(c, q));
  const frequentIds = new Set<string>();
  const frequent: Conversation[] = [];

  for (const r of getRegularRecipients()) {
    const hit = conversationForPhone(filtered, r.phone);
    if (hit && !frequentIds.has(hit.id)) {
      frequentIds.add(hit.id);
      frequent.push(hit);
    }
  }

  const recent = filtered.filter((c) => !frequentIds.has(c.id));
  return { frequent, recent };
}
