import type { ChatMessage, Conversation, MessageReaction } from "@/lib/api/types";

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

const PREFIXES = ["BLYP_R|", "\u200b\u200bR|"] as const;
const ALLOWED = new Set<string>(QUICK_REACTIONS);

export function encodeReactionSync(messageId: string, emoji: string): string {
  return `BLYP_R|${messageId}|${emoji}`;
}

/** Inbox liste : `*\t👍` = moi, `Jean\t👍` = l’autre. Ancien = emoji seul. */
const REACTION_SELF = "*";

export function encodeReactionListPreview(
  emoji: string,
  mine: boolean,
  reactorFirstName = "",
): string {
  const e = String(emoji ?? "").trim();
  if (!e) return "";
  if (mine) return `${REACTION_SELF}\t${e}`;
  return `${String(reactorFirstName ?? "").trim()}\t${e}`;
}

export function parseReactionListPreview(raw: string | null | undefined): {
  mine: boolean;
  name: string;
  emoji: string;
  encoded: boolean;
} {
  const s = String(raw ?? "");
  const tab = s.indexOf("\t");
  if (tab < 0) {
    return { mine: false, name: "", emoji: s.trim(), encoded: false };
  }
  const who = s.slice(0, tab).trim();
  const emoji = s.slice(tab + 1).trim();
  if (who === REACTION_SELF) {
    return { mine: true, name: "", emoji, encoded: true };
  }
  return { mine: false, name: who, emoji, encoded: true };
}

export function parseReactionSyncBody(
  body: string | null | undefined,
): { messageId: string; emoji: string } | null {
  const raw = String(body ?? "").trim();
  let rest = "";
  for (const p of PREFIXES) {
    if (raw.startsWith(p)) {
      rest = raw.slice(p.length);
      break;
    }
  }
  if (!rest) return null;
  const sep = rest.lastIndexOf("|");
  if (sep < 0) return null;
  const messageId = rest.slice(0, sep).trim();
  const emoji = rest.slice(sep + 1);
  if (!messageId) return null;
  if (emoji && !ALLOWED.has(emoji)) return null;
  return { messageId, emoji };
}

export function isReactionSyncBody(body: string | null | undefined): boolean {
  return parseReactionSyncBody(body) != null;
}

export function isReactionSyncMessage(msg: ChatMessage): boolean {
  return msg.type === "text" && parseReactionSyncBody(msg.body) != null;
}

function applyUserReaction(
  reactions: MessageReaction[] | undefined,
  userId: string,
  emoji: string,
): MessageReaction[] {
  const rest = (reactions ?? []).filter((r) => r.userId !== userId);
  if (!emoji) return rest;
  return [...rest, { userId, emoji }];
}

/** Retire les messages-sync et applique l’emoji sur la bulle cible. */
export function foldReactionSyncMessages(items: ChatMessage[]): ChatMessage[] {
  if (items.length === 0) return items;
  const syncs: {
    messageId: string;
    emoji: string;
    userId: string;
    createdAt: string;
  }[] = [];
  const visible: ChatMessage[] = [];
  for (const msg of items) {
    const parsed =
      msg.type === "text" ? parseReactionSyncBody(msg.body) : null;
    if (parsed && msg.senderUserId) {
      syncs.push({
        messageId: parsed.messageId,
        emoji: parsed.emoji,
        userId: msg.senderUserId,
        createdAt: msg.createdAt,
      });
    } else {
      visible.push(msg);
    }
  }
  if (syncs.length === 0) return items;
  syncs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const byId = new Map<string, ChatMessage>();
  for (const m of visible) {
    if (m.id) byId.set(m.id, m);
    const alt = (m as { messageId?: string }).messageId;
    if (alt) byId.set(alt, m);
  }
  let changed = false;
  for (const s of syncs) {
    const target = byId.get(s.messageId);
    if (!target) continue;
    const next = applyUserReaction(target.reactions, s.userId, s.emoji);
    byId.set(s.messageId, { ...target, reactions: next });
    changed = true;
  }
  if (!changed) return visible;
  return visible.map((m) => byId.get(m.id) ?? m);
}

/** Garde l’aperçu humain si le serveur a mis une réaction en lastMessage. */
export function sanitizeReactionPreviews(
  prev: Conversation[] | undefined,
  next: Conversation[],
): Conversation[] {
  let changed = false;
  const out = next.map((c) => {
    if (!isReactionSyncBody(c.lastMessagePreview)) return c;
    changed = true;
    const local = prev?.find((x) => x.id === c.id);
    if (local && !isReactionSyncBody(local.lastMessagePreview)) {
      return {
        ...c,
        lastMessagePreview: local.lastMessagePreview,
        lastMessageType: local.lastMessageType,
        lastMessageAt: local.lastMessageAt,
        updatedAt: local.updatedAt,
      };
    }
    return { ...c, lastMessagePreview: "" };
  });
  return changed ? out : next;
}
