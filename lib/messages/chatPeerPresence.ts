import { formatMessageTime } from "@/lib/format";
import i18n from "@/lib/i18n";

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function latestIso(a: string | null | undefined, b: string | null | undefined): string | null {
  const sa = String(a ?? "").trim();
  const sb = String(b ?? "").trim();
  if (!sa && !sb) return null;
  if (!sa) return sb;
  if (!sb) return sa;
  return sa >= sb ? sa : sb;
}

function formatPeerSeenAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const diffDays = Math.round(
    (startOfLocalDay(now) - startOfLocalDay(d)) / 86_400_000,
  );
  const time = formatMessageTime(iso);
  if (diffDays === 0) {
    return i18n.t("messages.presenceSeenToday", { time });
  }
  if (diffDays === 1) {
    return i18n.t("messages.presenceSeenYesterday", { time });
  }
  const locale = i18n.language?.startsWith("fr") ? "fr-FR" : "en-US";
  const date = d.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
  return i18n.t("messages.presenceSeenOn", { date, time });
}

export type ChatPeerHeaderStatus = {
  text: string;
  mode: "typing" | "online" | "seen" | "offline";
};

/** Sous-titre en-tête fil — « écrit… » ≠ « En ligne ». */
export function chatPeerHeaderStatus(opts: {
  peerTyping: boolean;
  peerFirstName: string;
  peerOnline: boolean;
  peerLastReadAt: string | null;
  peerLastDeliveredAt: string | null;
}): ChatPeerHeaderStatus {
  if (opts.peerTyping) {
    const name =
      String(opts.peerFirstName ?? "").trim() || i18n.t("messages.someone");
    return {
      text: i18n.t("messages.typing", { name }),
      mode: "typing",
    };
  }
  if (opts.peerOnline) {
    return { text: i18n.t("messages.presenceOnline"), mode: "online" };
  }
  const seenAt = latestIso(opts.peerLastReadAt, opts.peerLastDeliveredAt);
  if (seenAt) {
    const label = formatPeerSeenAt(seenAt);
    if (label) return { text: label, mode: "seen" };
  }
  return { text: i18n.t("messages.presenceOffline"), mode: "offline" };
}
