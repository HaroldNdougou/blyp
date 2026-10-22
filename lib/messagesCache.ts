import type {
  ChatMessage,
  Conversation,
  MessageReaction,
  MoneyTransfer,
} from "@/lib/api/types";
import { accessTokenSubject } from "@/lib/auth/accessTokenSubject";
import { getDb, runDbWrite } from "@/lib/db/sqlite";
import { isOutboundMessagePending } from "@/lib/messages/outboundPending";
import { applyMoneyReceiptOverride } from "@/lib/messages/moneyReceiptOverride";
import {
  foldReactionSyncMessages,
  sanitizeReactionPreviews,
} from "@/lib/messages/reactionSync";
import {
  getMessageReplyTo,
  withNormalizedReplyTo,
} from "@/lib/messages/replyPreview";
import { bindRecentEmojiOwner } from "@/lib/messages/recentChatEmojis";
import { conversationFieldsFromLastMessage } from "@/lib/messages/conversationListPreview";
import { runAfterPaint } from "@/lib/perf/deferAfterPaint";
import { THREAD_LIST_PAGE_SIZE } from "@/lib/messages/threadListWindow";

const MSG_CAP = 80;
/** 1er paint fil : N derniers messages SQLite, reste après interactions. */
const THREAD_SQLITE_TAIL = Math.max(THREAD_LIST_PAGE_SIZE, 40);

const conversationsByOwner = new Map<string, Conversation[]>();
const messagesByKey = new Map<string, ChatMessage[]>();

const threadSqliteExpandedListeners = new Set<(conversationId: string) => void>();

export function subscribeThreadSqliteExpanded(
  listener: (conversationId: string) => void,
): () => void {
  threadSqliteExpandedListeners.add(listener);
  return () => {
    threadSqliteExpandedListeners.delete(listener);
  };
}

function notifyThreadSqliteExpanded(conversationId: string): void {
  const cid = String(conversationId ?? "").trim();
  if (!cid) return;
  threadSqliteExpandedListeners.forEach((l) => l(cid));
}
const receiptsByKey = new Map<string, ConversationReceiptsSnap>();
const hydratePromises = new Map<string, Promise<void>>();
const hydratedPhones = new Set<string>();

let ownerPhone: string | null = null;

function ownerKey(token: string): string {
  return ownerPhone || token;
}

function conversationActivityAt(c: Conversation): string {
  return String(c.lastMessageAt ?? c.updatedAt ?? "").trim();
}

const DEMO_CONVERSATION_PREFIX = "demo-conv-";

export function isDemoConversationId(id: string): boolean {
  return String(id ?? "").startsWith(DEMO_CONVERSATION_PREFIX);
}

/** Vraies discussions en tête (récentes d’abord) ; fils fictifs dev toujours en bas. */
export function sortConversationsByActivity(
  items: Conversation[],
): Conversation[] {
  const real: Conversation[] = [];
  const demo: Conversation[] = [];
  for (const c of items) {
    if (isDemoConversationId(c.id)) demo.push(c);
    else real.push(c);
  }
  const byActivity = (a: Conversation, b: Conversation) =>
    conversationActivityAt(b).localeCompare(conversationActivityAt(a));
  real.sort(byActivity);
  demo.sort(byActivity);
  return [...real, ...demo];
}

/** Garde l’aperçu local si plus récent que le fetch serveur (évite qu’un fil démo repasse devant). */
function threadHasOutboundPending(conversationId: string): boolean {
  const cid = String(conversationId ?? "").trim();
  if (!cid || !ownerPhone) return false;
  const msgs = messagesByKey.get(`${ownerPhone}::${cid}`);
  const last = msgs?.[msgs.length - 1];
  return last ? isOutboundMessagePending(last) : false;
}

function mergeNewerConversationPreview(
  prev: Conversation | undefined,
  next: Conversation,
): Conversation {
  if (!prev) return next;
  const prevAt = conversationActivityAt(prev);
  const nextAt = conversationActivityAt(next);
  if (
    prev.lastMessageFromSelf &&
    String(prev.lastMessagePreview ?? "").trim() &&
    threadHasOutboundPending(next.id)
  ) {
    return {
      ...next,
      lastMessagePreview: prev.lastMessagePreview,
      lastMessageType: prev.lastMessageType ?? next.lastMessageType,
      lastMessageAt: prev.lastMessageAt ?? next.lastMessageAt,
      updatedAt: prevAt.localeCompare(nextAt) > 0 ? prev.updatedAt : next.updatedAt,
      lastMessageFromSelf: true,
    };
  }
  if (prevAt && prevAt.localeCompare(nextAt) > 0) {
    return {
      ...next,
      lastMessagePreview: prev.lastMessagePreview,
      lastMessageType: prev.lastMessageType,
      lastMessageAt: prev.lastMessageAt,
      updatedAt: prev.updatedAt,
      lastMessageFromSelf: prev.lastMessageFromSelf,
    };
  }
  return next;
}

function stitchConversationLists(
  prev: Conversation[] | undefined,
  next: Conversation[],
): Conversation[] {
  const prevById = new Map((prev ?? []).map((c) => [c.id, c]));
  const nextIds = new Set(next.map((c) => c.id));
  const merged: Conversation[] = next.map((c) =>
    mergeNewerConversationPreview(prevById.get(c.id), c),
  );
  for (const c of prev ?? []) {
    if (!nextIds.has(c.id)) merged.push(c);
  }
  return sortConversationsByActivity(merged);
}

function msgKey(token: string, conversationId: string) {
  return `${ownerKey(token)}::${conversationId}`;
}

function receiptKey(conversationId: string) {
  return String(conversationId ?? "").trim();
}

function persistConversations(phone: string, items: Conversation[]) {
  void runDbWrite(async (db) => {
    await db.withTransactionAsync(async () => {
      await db.runAsync(`DELETE FROM conversations WHERE phone = ?`, phone);
      for (const c of items) {
        await db.runAsync(
          `INSERT INTO conversations (phone, id, json, updatedAt) VALUES (?, ?, ?, ?)`,
          phone,
          c.id,
          JSON.stringify(c),
          c.updatedAt || c.lastMessageAt || "",
        );
      }
    });
  });
}

function persistMessages(
  phone: string,
  conversationId: string,
  items: ChatMessage[],
) {
  void runDbWrite(async (db) => {
    await db.runAsync(
      `INSERT OR REPLACE INTO chat_messages (phone, conversationId, json) VALUES (?, ?, ?)`,
      phone,
      conversationId,
      JSON.stringify(items.slice(-MSG_CAP)),
    );
  });
}

function persistReceipts(
  conversationId: string,
  snap: ConversationReceiptsSnap,
) {
  const phone = ownerPhone;
  if (!phone) return;
  void runDbWrite(async (db) => {
    await db.runAsync(
      `INSERT OR REPLACE INTO chat_receipts
        (phone, conversationId, peerLastReadAt, peerLastDeliveredAt)
       VALUES (?, ?, ?, ?)`,
      phone,
      conversationId,
      snap.peerLastReadAt,
      snap.peerLastDeliveredAt,
    );
  });
}

export function conversationsEqual(
  a: Conversation[],
  b: Conversation[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.lastMessageAt !== y.lastMessageAt ||
      x.lastMessagePreview !== y.lastMessagePreview ||
      x.lastMessageType !== y.lastMessageType ||
      x.peerName !== y.peerName ||
      x.peerUserId !== y.peerUserId ||
      x.updatedAt !== y.updatedAt ||
      x.lastMessageFromSelf !== y.lastMessageFromSelf
    ) {
      return false;
    }
  }
  return true;
}

export function messagesEqual(a: ChatMessage[], b: ChatMessage[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || x.createdAt !== y.createdAt || x.type !== y.type) {
      return false;
    }
    const xt = x.moneyTransfer;
    const yt = y.moneyTransfer;
    if ((xt?.status ?? "") !== (yt?.status ?? "")) return false;
    if (Boolean(xt?.receiptRequired) !== Boolean(yt?.receiptRequired)) {
      return false;
    }
    if ((xt?.claimedByFirstName ?? "") !== (yt?.claimedByFirstName ?? "")) {
      return false;
    }
    if ((x.voice?.key ?? "") !== (y.voice?.key ?? "")) return false;
    if ((x.voice?.localUri ?? "") !== (y.voice?.localUri ?? "")) return false;
    if ((x.image?.key ?? "") !== (y.image?.key ?? "")) return false;
    if ((x.image?.localUri ?? "") !== (y.image?.localUri ?? "")) return false;
    if ((x.body ?? "") !== (y.body ?? "")) return false;
    if (
      (getMessageReplyTo(x)?.messageId ?? "") !==
      (getMessageReplyTo(y)?.messageId ?? "")
    ) {
      return false;
    }
    if (reactionsKey(x.reactions) !== reactionsKey(y.reactions)) return false;
    if ((x.moneyFruitEmoji ?? "") !== (y.moneyFruitEmoji ?? "")) {
      return false;
    }
  }
  return true;
}

function reactionsKey(list: MessageReaction[] | undefined): string {
  if (!list || list.length === 0) return "";
  return list
    .map((r) => `${r.userId}:${r.emoji}`)
    .sort()
    .join("|");
}

export function pickEarlierIso(
  a: string | null | undefined,
  b: string | null | undefined,
): string {
  const sa = String(a ?? "").trim();
  const sb = String(b ?? "").trim();
  if (!sa) return sb;
  if (!sb) return sa;
  return sa <= sb ? sa : sb;
}

function coalesceReplyTo(
  local: ChatMessage | undefined,
  server: ChatMessage,
): ChatMessage["replyTo"] {
  return (
    getMessageReplyTo(server) ??
    (local ? getMessageReplyTo(local) : null)
  );
}

/** Ne pas reculer createdAt / expiresAt au rechargement réseau (évite « Aujourd’hui » + expiration repoussée). */
function preserveMessageTimestamps(
  local: ChatMessage,
  server: ChatMessage,
): ChatMessage {
  const createdAt = pickEarlierIso(local.createdAt, server.createdAt);
  const lt = local.moneyTransfer;
  const st = server.moneyTransfer;
  let moneyTransfer = st ?? lt ?? null;
  if (lt && st && lt.transferId === st.transferId) {
    let expiresAt = st.expiresAt ?? lt.expiresAt ?? null;
    if (lt.expiresAt && st.expiresAt) {
      expiresAt =
        Date.parse(lt.expiresAt) <= Date.parse(st.expiresAt)
          ? lt.expiresAt
          : st.expiresAt;
    }
    moneyTransfer = applyMoneyReceiptOverride({
      ...st,
      expiresAt,
      createdAt: pickEarlierIso(lt.createdAt, st.createdAt),
    });
  }
  const moneyFruitEmoji =
    String(server.moneyFruitEmoji ?? "").trim() ||
    String(local.moneyFruitEmoji ?? "").trim() ||
    null;
  return {
    ...server,
    createdAt,
    moneyTransfer,
    replyTo: coalesceReplyTo(local, server),
    moneyFruitEmoji,
  };
}

/** Garde la date d’expiration / création du transfert la plus ancienne (source de vérité locale). */
export function mergeMoneyTransfer(
  local: MoneyTransfer | null | undefined,
  incoming: MoneyTransfer,
): MoneyTransfer {
  if (!local || local.transferId !== incoming.transferId) return incoming;
  let expiresAt = incoming.expiresAt || local.expiresAt;
  if (local.expiresAt && incoming.expiresAt) {
    expiresAt =
      Date.parse(local.expiresAt) <= Date.parse(incoming.expiresAt)
        ? local.expiresAt
        : incoming.expiresAt;
  }
  const merged: MoneyTransfer = {
    ...incoming,
    expiresAt,
    createdAt: pickEarlierIso(local.createdAt, incoming.createdAt),
  };
  return applyMoneyReceiptOverride(merged);
}

function stitchServerMessages(
  prev: ChatMessage[] | undefined,
  incoming: ChatMessage[],
): ChatMessage[] {
  if (!prev?.length) return incoming;
  const byId = new Map(prev.map((m) => [m.id, m]));
  const byClient = new Map<string, ChatMessage>();
  for (const m of prev) {
    if (m.clientId) byClient.set(m.clientId, m);
  }
  return incoming.map((inc) => {
    const local =
      byId.get(inc.id) ??
      (inc.clientId ? byClient.get(inc.clientId) : undefined);
    return local ? preserveMessageTimestamps(local, inc) : inc;
  });
}

/** Garde les bulles locales (optimistes / plus récentes) qu’un fetch périmé n’a pas. */
export function mergeNewerOrPending(
  prev: ChatMessage[] | undefined,
  incoming: ChatMessage[],
): ChatMessage[] {
  if (!prev || prev.length === 0) return incoming;
  if (incoming.length === 0) return prev;

  const incomingIds = new Set<string>();
  const incomingClients = new Set<string>();
  let maxIncomingAt = "";
  for (const m of incoming) {
    if (m.id) incomingIds.add(m.id);
    if (m.clientId) incomingClients.add(m.clientId);
    if (m.createdAt && m.createdAt > maxIncomingAt) maxIncomingAt = m.createdAt;
  }

  const extras: ChatMessage[] = [];
  for (const local of prev) {
    if (incomingIds.has(local.id)) continue;
    if (local.clientId && incomingClients.has(local.clientId)) continue;
    const pending = Boolean(local.clientId && local.id === local.clientId);
    const newer = Boolean(local.createdAt && local.createdAt > maxIncomingAt);
    if (pending || newer) extras.push(local);
  }
  if (extras.length === 0) return incoming;

  const merged = incoming.concat(extras);
  merged.sort((a, b) => {
    const c = String(a.createdAt).localeCompare(String(b.createdAt));
    return c !== 0 ? c : String(a.id).localeCompare(String(b.id));
  });
  return merged;
}

function mergeLocalReactions(
  prev: ChatMessage[] | undefined,
  next: ChatMessage[],
): ChatMessage[] {
  if (!prev || prev.length === 0) return next;
  const localById = new Map<string, MessageReaction[] | undefined>();
  for (const m of prev) localById.set(m.id, m.reactions);
  let changed = false;
  const out = next.map((m) => {
    if (m.reactions !== undefined) return m;
    const loc = localById.get(m.id);
    if (!loc || loc.length === 0) return m;
    changed = true;
    return { ...m, reactions: loc };
  });
  return changed ? out : next;
}

function mergeLocalMoneyFruitEmoji(
  prev: ChatMessage[] | undefined,
  next: ChatMessage[],
): ChatMessage[] {
  if (!prev?.length) return next;
  const byId = new Map<string, string>();
  const byClient = new Map<string, string>();
  for (const m of prev) {
    const fruit = String(m.moneyFruitEmoji ?? "").trim();
    if (!fruit) continue;
    byId.set(m.id, fruit);
    if (m.clientId) byClient.set(m.clientId, fruit);
  }
  if (byId.size === 0 && byClient.size === 0) return next;
  let changed = false;
  const out = next.map((m) => {
    if (String(m.moneyFruitEmoji ?? "").trim()) return m;
    const fruit =
      byId.get(m.id) ??
      (m.clientId ? byClient.get(m.clientId) : undefined);
    if (!fruit) return m;
    changed = true;
    return { ...m, moneyFruitEmoji: fruit };
  });
  return changed ? out : next;
}

function mergeLocalVoiceUris(
  prev: ChatMessage[] | undefined,
  next: ChatMessage[],
): ChatMessage[] {
  if (!prev || prev.length === 0) return next;
  const uriByKey = new Map<string, string>();
  for (const m of prev) {
    const k = m.voice?.key;
    const u = m.voice?.localUri;
    if (k && u) uriByKey.set(k, u);
  }
  if (uriByKey.size === 0) return next;
  let changed = false;
  const out = next.map((m) => {
    const k = m.voice?.key;
    const local = k ? uriByKey.get(k) : undefined;
    if (!local || !m.voice || m.voice.localUri === local) return m;
    changed = true;
    return { ...m, voice: { ...m.voice, localUri: local } };
  });
  return changed ? out : next;
}

function mergeLocalReplyTo(
  prev: ChatMessage[] | undefined,
  next: ChatMessage[],
): ChatMessage[] {
  if (!prev?.length) return next;
  const byId = new Map<string, ChatMessage>();
  const byClient = new Map<string, ChatMessage>();
  for (const m of prev) {
    byId.set(m.id, m);
    if (m.clientId) byClient.set(m.clientId, m);
  }
  let changed = false;
  const out = next.map((m) => {
    if (getMessageReplyTo(m)) return m;
    const local =
      byId.get(m.id) ?? (m.clientId ? byClient.get(m.clientId) : undefined);
    const localReply = local ? getMessageReplyTo(local) : null;
    if (!localReply) return m;
    changed = true;
    return { ...m, replyTo: localReply };
  });
  return changed ? out : next;
}

function mergeLocalImageUris(
  prev: ChatMessage[] | undefined,
  next: ChatMessage[],
): ChatMessage[] {
  if (!prev || prev.length === 0) return next;
  const uriByKey = new Map<string, string>();
  const blurByKey = new Map<string, string>();
  const thumbByKey = new Map<string, string>();
  for (const m of prev) {
    const k = m.image?.key;
    const u = m.image?.localUri;
    if (k && u) uriByKey.set(k, u);
    const bh = String(m.image?.blurhash ?? "").trim();
    if (k && bh) blurByKey.set(k, bh);
    const tk = String(m.image?.thumbKey ?? "").trim();
    if (k && tk) thumbByKey.set(k, tk);
  }
  if (uriByKey.size === 0 && blurByKey.size === 0 && thumbByKey.size === 0) {
    return next;
  }
  let changed = false;
  const out = next.map((m) => {
    const k = m.image?.key;
    const local = k ? uriByKey.get(k) : undefined;
    const blur = k ? blurByKey.get(k) : undefined;
    const thumb = k ? thumbByKey.get(k) : undefined;
    if (!m.image) return m;
    const nextUri = local ?? m.image.localUri;
    const nextBlur = blur ?? m.image.blurhash;
    const nextThumb = thumb ?? m.image.thumbKey;
    if (
      nextUri === m.image.localUri &&
      nextBlur === m.image.blurhash &&
      nextThumb === m.image.thumbKey
    ) {
      return m;
    }
    changed = true;
    return {
      ...m,
      image: {
        ...m.image,
        localUri: nextUri,
        blurhash: nextBlur ?? null,
        thumbKey: nextThumb ?? null,
      },
    };
  });
  return changed ? out : next;
}

function migrateOwnerKey(from: string, to: string) {
  if (!from || !to || from === to) return;
  const convs = conversationsByOwner.get(from);
  if (convs && !conversationsByOwner.has(to)) {
    conversationsByOwner.set(to, convs);
  }
  conversationsByOwner.delete(from);
  const prefix = `${from}::`;
  for (const [key, items] of [...messagesByKey]) {
    if (!key.startsWith(prefix)) continue;
    const cid = key.slice(prefix.length);
    const dest = `${to}::${cid}`;
    if (!messagesByKey.has(dest)) messagesByKey.set(dest, items);
    messagesByKey.delete(key);
  }
}

export function getMessagesCacheOwnerPhone(): string | null {
  return ownerPhone;
}

/** Clé persist = téléphone, pas le JWT (refresh / relog). */
export function bindMessagesCacheOwner(
  phone: string | null,
  token?: string | null,
): void {
  const next = String(phone ?? "").trim() || null;
  if (next && token) migrateOwnerKey(token, next);
  if (ownerPhone && next && ownerPhone !== next) {
    migrateOwnerKey(ownerPhone, next);
  }
  ownerPhone = next;
  bindRecentEmojiOwner(next);
}

export function hydrateMessagesCache(
  phone: string,
  token?: string | null,
): Promise<void> {
  const p = String(phone ?? "").trim();
  if (!p) return Promise.resolve();
  bindMessagesCacheOwner(p, token);
  const existing = hydratePromises.get(p);
  if (existing) return existing;

  const job = (async () => {
    if (hydratedPhones.has(p)) return;
    const db = await getDb();
    if (!db) {
      hydratedPhones.add(p);
      return;
    }
    if (!conversationsByOwner.has(p)) {
      const convRows = await db.getAllAsync<{ json: string }>(
        `SELECT json FROM conversations WHERE phone = ? ORDER BY updatedAt DESC`,
        p,
      );
      if (!conversationsByOwner.has(p) && convRows.length > 0) {
        const items: Conversation[] = [];
        for (const row of convRows) {
          try {
            items.push(JSON.parse(row.json) as Conversation);
          } catch {
            /* ligne corrompue */
          }
        }
        if (items.length > 0) conversationsByOwner.set(p, items);
      }
    }
    const msgRows = await db.getAllAsync<{
      conversationId: string;
      json: string;
    }>(`SELECT conversationId, json FROM chat_messages WHERE phone = ?`, p);
    for (const row of msgRows) {
      const key = `${p}::${row.conversationId}`;
      if (messagesByKey.has(key)) continue;
      try {
        const parsed = JSON.parse(row.json) as ChatMessage[];
        if (Array.isArray(parsed)) {
          messagesByKey.set(
            key,
            foldReactionSyncMessages(parsed.map(withNormalizedReplyTo)),
          );
        }
      } catch {
        /* ligne corrompue */
      }
    }
    const recRows = await db.getAllAsync<{
      conversationId: string;
      peerLastReadAt: string | null;
      peerLastDeliveredAt: string | null;
    }>(
      `SELECT conversationId, peerLastReadAt, peerLastDeliveredAt FROM chat_receipts WHERE phone = ?`,
      p,
    );
    for (const row of recRows) {
      const k = receiptKey(row.conversationId);
      if (!k || receiptsByKey.has(k)) continue;
      receiptsByKey.set(k, {
        peerLastReadAt: row.peerLastReadAt,
        peerLastDeliveredAt: row.peerLastDeliveredAt,
      });
    }
    hydratedPhones.add(p);
  })()
    .catch(() => {
      /* SQLite indispo / verrou : le réseau remplit la RAM, retry au prochain hydrate */
    })
    .finally(() => {
      hydratePromises.delete(p);
    });

  hydratePromises.set(p, job);
  return job;
}

/** Un seul fil SQLite → RAM (clic liste avant hydrate global). */
export function ensureMessagesSnapshotFromDb(
  phone: string,
  token: string,
  conversationId: string,
): Promise<ChatMessage[] | null> {
  const p = String(phone ?? "").trim();
  const cid = String(conversationId ?? "").trim();
  if (!p || !cid || !token) return Promise.resolve(null);
  bindMessagesCacheOwner(p, token);
  const ram = getMessagesSnapshot(token, cid);
  if (ram && ram.length > 0) return Promise.resolve(ram);

  return (async () => {
    const db = await getDb();
    if (!db) return null;
    const row = await db.getFirstAsync<{ json: string }>(
      `SELECT json FROM chat_messages WHERE phone = ? AND conversationId = ?`,
      p,
      cid,
    );
    if (!row?.json) return null;
    try {
      const parsed = JSON.parse(row.json) as ChatMessage[];
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      const folded = foldReactionSyncMessages(
        parsed.map(withNormalizedReplyTo),
      );
      const key = msgKey(token, cid);
      if (folded.length > THREAD_SQLITE_TAIL) {
        const tail = folded.slice(-THREAD_SQLITE_TAIL);
        messagesByKey.set(key, tail);
        runAfterPaint(() => {
          const cur = messagesByKey.get(key);
          if (cur && cur.length >= folded.length) return;
          messagesByKey.set(key, folded);
          notifyThreadSqliteExpanded(cid);
        });
      } else {
        messagesByKey.set(key, folded);
      }
      const rec = await db.getFirstAsync<{
        peerLastReadAt: string | null;
        peerLastDeliveredAt: string | null;
      }>(
        `SELECT peerLastReadAt, peerLastDeliveredAt FROM chat_receipts WHERE phone = ? AND conversationId = ?`,
        p,
        cid,
      );
      if (rec) {
        const rk = receiptKey(cid);
        if (rk && !receiptsByKey.has(rk)) {
          receiptsByKey.set(rk, {
            peerLastReadAt: rec.peerLastReadAt,
            peerLastDeliveredAt: rec.peerLastDeliveredAt,
          });
        }
      }
      return messagesByKey.get(key) ?? folded;
    } catch {
      return null;
    }
  })();
}

export function getConversationsSnapshot(
  token: string,
): Conversation[] | null {
  if (!token && !ownerPhone) return null;
  const k = ownerKey(token);
  const v = conversationsByOwner.get(k);
  return v !== undefined ? v : null;
}

export function setConversationsSnapshot(
  token: string,
  items: Conversation[],
) {
  if (!token && !ownerPhone) return;
  const k = ownerKey(token);
  const prev = conversationsByOwner.get(k);
  const cleaned = sanitizeReactionPreviews(prev, items);
  const stitched = stitchConversationLists(prev, cleaned);
  if (prev && conversationsEqual(prev, stitched)) return;
  conversationsByOwner.set(k, stitched);
  if (ownerPhone) persistConversations(ownerPhone, stitched);
}

export function getMessagesSnapshot(
  token: string,
  conversationId: string,
): ChatMessage[] | null {
  if (!token && !ownerPhone) return null;
  const v = messagesByKey.get(msgKey(token, conversationId));
  return v !== undefined ? v : null;
}

export type OptimisticVoiceJob = {
  conversationId: string;
  clientId: string;
  uri: string;
  durationMs: number;
  replyToMessageId?: string | null;
};

/** Vocaux encore locaux (id = clientId, pas de clé S3) — à renvoyer au réseau. */
export function listOptimisticVoiceOutbox(token: string): OptimisticVoiceJob[] {
  const prefix = `${ownerKey(token)}::`;
  const out: OptimisticVoiceJob[] = [];
  for (const [key, msgs] of messagesByKey) {
    if (!key.startsWith(prefix)) continue;
    const conversationId = key.slice(prefix.length);
    if (!conversationId) continue;
    for (const m of msgs) {
      if (m.type !== "voice" || !m.clientId || m.id !== m.clientId) continue;
      const uri = String(m.voice?.localUri ?? "").trim();
      if (!uri) continue;
      if (String(m.voice?.key ?? "").trim()) continue;
      out.push({
        conversationId,
        clientId: m.clientId,
        uri,
        durationMs: Math.max(0, Math.floor(Number(m.voice?.durationMs) || 0)),
        replyToMessageId: m.replyTo?.messageId ?? null,
      });
    }
  }
  return out;
}

export function commitOptimisticVoice(
  token: string,
  conversationId: string,
  clientId: string,
  message: ChatMessage,
): ChatMessage[] | null {
  const prev = getMessagesSnapshot(token, conversationId);
  if (!prev) return null;
  let hit = false;
  const next = prev.map((x) => {
    if (x.clientId !== clientId) return x;
    hit = true;
    return withNormalizedReplyTo({
      ...message,
      replyTo:
        getMessageReplyTo(message) ??
        getMessageReplyTo(x) ??
        message.replyTo ??
        x.replyTo ??
        null,
    });
  });
  if (!hit) return prev;
  setMessagesSnapshot(token, conversationId, next);
  return getMessagesSnapshot(token, conversationId) ?? next;
}

export type OptimisticTextJob = {
  conversationId: string;
  clientId: string;
  body: string;
  replyToMessageId?: string | null;
};

/** Textes encore locaux (id = clientId) — à renvoyer au réseau. */
export function listOptimisticTextOutbox(token: string): OptimisticTextJob[] {
  const prefix = `${ownerKey(token)}::`;
  const out: OptimisticTextJob[] = [];
  for (const [key, msgs] of messagesByKey) {
    if (!key.startsWith(prefix)) continue;
    const conversationId = key.slice(prefix.length);
    if (!conversationId) continue;
    for (const m of msgs) {
      if (m.type !== "text" || !m.clientId || m.id !== m.clientId) continue;
      const body = String(m.body ?? "").trim();
      if (!body) continue;
      out.push({
        conversationId,
        clientId: m.clientId,
        body,
        replyToMessageId: m.replyTo?.messageId ?? null,
      });
    }
  }
  return out;
}

export type OptimisticImageJob = {
  conversationId: string;
  clientId: string;
  uri: string;
  width: number;
  height: number;
  contentType: string;
  caption: string;
  replyToMessageId?: string | null;
};

export function listOptimisticImageOutbox(token: string): OptimisticImageJob[] {
  const prefix = `${ownerKey(token)}::`;
  const out: OptimisticImageJob[] = [];
  for (const [key, msgs] of messagesByKey) {
    if (!key.startsWith(prefix)) continue;
    const conversationId = key.slice(prefix.length);
    if (!conversationId) continue;
    for (const m of msgs) {
      if (m.type !== "image" || !m.clientId || m.id !== m.clientId) continue;
      const uri = String(m.image?.localUri ?? "").trim();
      if (!uri) continue;
      if (String(m.image?.key ?? "").trim()) continue;
      out.push({
        conversationId,
        clientId: m.clientId,
        uri,
        width: Math.max(0, Math.floor(Number(m.image?.width) || 0)),
        height: Math.max(0, Math.floor(Number(m.image?.height) || 0)),
        contentType: String(m.image?.contentType ?? "").trim() || "image/jpeg",
        caption: String(m.body ?? "").trim(),
        replyToMessageId: m.replyTo?.messageId ?? null,
      });
    }
  }
  return out;
}

export function commitOptimisticImage(
  token: string,
  conversationId: string,
  clientId: string,
  message: ChatMessage,
): ChatMessage[] | null {
  return commitOptimisticVoice(token, conversationId, clientId, message);
}

/** Compression / blurhash avant upload — garde la bulle optimiste à jour. */
export function patchOptimisticImageLocal(
  token: string,
  conversationId: string,
  clientId: string,
  patch: {
    localUri: string;
    width: number;
    height: number;
    contentType: string;
    blurhash: string | null;
  },
): ChatMessage[] | null {
  const key = msgKey(token, conversationId);
  const prev = messagesByKey.get(key);
  if (!prev?.length) return null;
  let changed = false;
  const next = prev.map((m) => {
    if (m.clientId !== clientId || m.type !== "image" || !m.image) return m;
    changed = true;
    return {
      ...m,
      image: {
        ...m.image,
        localUri: patch.localUri,
        width: patch.width,
        height: patch.height,
        contentType: patch.contentType,
        blurhash: patch.blurhash,
      },
    };
  });
  if (!changed) return null;
  messagesByKey.set(key, next);
  if (ownerPhone) persistMessages(ownerPhone, conversationId, next);
  return next;
}

export type OptimisticMoneyJob = {
  conversationId: string;
  clientId: string;
  amountFcfa: number;
  idempotencyKey: string;
  replyToMessageId?: string | null;
  caption?: string | null;
  moneyFruitEmoji?: string | null;
  receiptRequired?: boolean;
};

/** 💰 encore locaux (id = clientId) — PIN en SecureStore, idempotence sur le message. */
export function listOptimisticMoneyOutbox(token: string): OptimisticMoneyJob[] {
  const prefix = `${ownerKey(token)}::`;
  const out: OptimisticMoneyJob[] = [];
  for (const [key, msgs] of messagesByKey) {
    if (!key.startsWith(prefix)) continue;
    const conversationId = key.slice(prefix.length);
    if (!conversationId) continue;
    for (const m of msgs) {
      if (m.type !== "money" || !m.clientId || m.id !== m.clientId) continue;
      const amountFcfa = Math.max(
        0,
        Math.floor(Number(m.moneyTransfer?.amountFcfa) || 0),
      );
      if (amountFcfa <= 0) continue;
      const idempotencyKey = String(
        m.moneySendIdempotencyKey ?? m.clientId ?? "",
      ).trim();
      if (!idempotencyKey) continue;
      out.push({
        conversationId,
        clientId: m.clientId,
        amountFcfa,
        idempotencyKey,
        replyToMessageId: m.replyTo?.messageId ?? null,
        caption: m.body,
        moneyFruitEmoji: m.moneyFruitEmoji ?? null,
        receiptRequired: Boolean(m.moneyTransfer?.receiptRequired),
      });
    }
  }
  return out;
}

export function setMessagesSnapshot(
  token: string,
  conversationId: string,
  items: ChatMessage[],
) {
  writeMessagesSnapshot(token, conversationId, items, false);
}

/** Insert immédiat depuis le push — le réseau confirme après. */
export function upsertPushedMessage(
  token: string | null,
  msg: ChatMessage,
): ChatMessage[] | null {
  const cid = String(msg.conversationId ?? "").trim();
  const id = String(msg.id ?? "").trim();
  if (!cid || !id) return null;
  const access = String(token ?? "").trim();
  if (!access && !ownerPhone) return null;
  const key = access || ownerPhone || "";
  const prev = getMessagesSnapshot(key, cid) ?? [];
  const existing = prev.find((m) => m.id === id);
  if (existing) {
    const merged = preserveMessageTimestamps(existing, msg);
    const next = prev.map((m) => (m.id === id ? merged : m));
    setMessagesSnapshot(key, cid, next);
    bumpConversationFromMessage(key, merged);
    return next;
  }
  const next = [...prev, msg].slice(-MSG_CAP);
  setMessagesSnapshot(key, cid, next);
  bumpConversationFromMessage(key, msg);
  return next;
}

export function bumpConversationFromMessage(token: string, msg: ChatMessage) {
  const prev = getConversationsSnapshot(token);
  if (!prev) return;
  const cid = msg.conversationId;
  const cur = prev.find((c) => c.id === cid);
  if (!cur) return;
  const fields = conversationFieldsFromLastMessage(msg, token);
  const now = fields.lastMessageAt;
  const updated: Conversation = {
    ...cur,
    ...fields,
    updatedAt: now,
  };
  setConversationsSnapshot(
    token,
    sortConversationsByActivity([
      updated,
      ...prev.filter((c) => c.id !== cid),
    ]),
  );
}

/** Recalcule l’aperçu liste depuis le fil local (ex. après « supprimer pour moi »). */
export function syncConversationPreviewFromThread(
  token: string,
  conversationId: string,
): void {
  const cid = String(conversationId ?? "").trim();
  if (!cid || !token) return;
  const prev = getConversationsSnapshot(token);
  if (!prev) return;
  const cur = prev.find((c) => c.id === cid);
  if (!cur) return;
  const msgs = getMessagesSnapshot(token, cid);
  if (!msgs?.length) return;
  const last = msgs[msgs.length - 1];
  const fields = conversationFieldsFromLastMessage(last, token);
  const updated: Conversation = {
    ...cur,
    ...fields,
    updatedAt: fields.lastMessageAt,
  };
  setConversationsSnapshot(
    token,
    sortConversationsByActivity([
      updated,
      ...prev.filter((c) => c.id !== cid),
    ]),
  );
}

/** Fetch réseau : ne pas écraser un envoi local plus récent. */
export function applyServerMessagesSnapshot(
  token: string,
  conversationId: string,
  items: ChatMessage[],
) {
  writeMessagesSnapshot(token, conversationId, items, true);
}

function writeMessagesSnapshot(
  token: string,
  conversationId: string,
  items: ChatMessage[],
  fromServer: boolean,
) {
  if ((!token && !ownerPhone) || !conversationId) return;
  const key = msgKey(token, conversationId);
  const prev = messagesByKey.get(key);
  const foldedIncoming = foldReactionSyncMessages(items);
  const prevFolded = prev ? foldReactionSyncMessages(prev) : prev;
  const stitched = fromServer
    ? stitchServerMessages(prevFolded, foldedIncoming)
    : foldedIncoming;
  const base = fromServer
    ? mergeNewerOrPending(prevFolded, stitched)
    : stitched;
  const merged = mergeLocalReplyTo(
    prevFolded,
    mergeLocalReactions(
      prevFolded,
      mergeLocalImageUris(
        prevFolded,
        mergeLocalVoiceUris(
          prevFolded,
          mergeLocalMoneyFruitEmoji(prevFolded, base),
        ),
      ),
    ),
  ).slice(-MSG_CAP);
  const normalized = merged.map(withNormalizedReplyTo);
  if (prev && messagesEqual(prev, normalized)) return;
  messagesByKey.set(key, normalized);
  if (ownerPhone) persistMessages(ownerPhone, conversationId, normalized);
}

export function clearAllMessagesSnapshots() {
  conversationsByOwner.clear();
  messagesByKey.clear();
  receiptsByKey.clear();
  hydratedPhones.clear();
  ownerPhone = null;
  void import("@/lib/messages/unread").then((m) => m.clearAllUnread());
}

export type ConversationReceiptsSnap = {
  peerLastReadAt: string | null;
  peerLastDeliveredAt: string | null;
};

export function getReceiptsSnapshot(
  conversationId: string,
): ConversationReceiptsSnap | null {
  const k = receiptKey(conversationId);
  if (!k) return null;
  return receiptsByKey.get(k) ?? null;
}

export function setReceiptsSnapshot(
  conversationId: string,
  snap: ConversationReceiptsSnap,
): void {
  const k = receiptKey(conversationId);
  if (!k) return;
  const prev = receiptsByKey.get(k);
  if (
    prev &&
    prev.peerLastReadAt === snap.peerLastReadAt &&
    prev.peerLastDeliveredAt === snap.peerLastDeliveredAt
  ) {
    return;
  }
  receiptsByKey.set(k, snap);
  persistReceipts(k, snap);
}

export function patchReceipts(
  conversationId: string,
  kind: "read" | "delivered",
  at: string,
): ConversationReceiptsSnap | null {
  const k = receiptKey(conversationId);
  if (!k || !at) return null;
  const prev = receiptsByKey.get(k) ?? {
    peerLastReadAt: null,
    peerLastDeliveredAt: null,
  };
  const next = { ...prev };
  if (kind === "read") {
    if (!prev.peerLastReadAt || at > prev.peerLastReadAt) {
      next.peerLastReadAt = at;
    }
    if (!prev.peerLastDeliveredAt || at > prev.peerLastDeliveredAt) {
      next.peerLastDeliveredAt = at;
    }
  } else if (!prev.peerLastDeliveredAt || at > prev.peerLastDeliveredAt) {
    next.peerLastDeliveredAt = at;
  }
  receiptsByKey.set(k, next);
  persistReceipts(k, next);
  return next;
}

export type MoneyClaimedPatch = {
  conversationId: string;
  transferId: string;
  claimedByFirstName: string;
  claimedAt: string;
};

export type MoneyUpdatedPatch = {
  conversationId: string;
  transferId: string;
  status?: string;
  claimedByFirstName?: string;
  claimedByUserId?: string;
  thanksFirstName?: string;
  thanksUserId?: string;
  claimedAt?: string;
  receiptRequired?: boolean;
};

/** Patch RAM — no-op si déjà claimed. */
export function patchMoneyClaimed(patch: MoneyClaimedPatch): ChatMessage[] | null {
  const conversationId = String(patch.conversationId ?? "").trim();
  const transferId = String(patch.transferId ?? "").trim();
  if (!conversationId || !transferId) return null;
  const name = String(patch.claimedByFirstName ?? "").trim();
  const claimedAt =
    String(patch.claimedAt ?? "").trim() || new Date().toISOString();
  const suffix = `::${conversationId}`;
  let touched: ChatMessage[] | null = null;
  for (const [key, items] of messagesByKey) {
    if (!key.endsWith(suffix)) continue;
    let hit = false;
    const next = items.map((msg) => {
      const tr = msg.moneyTransfer;
      if (!tr || tr.transferId !== transferId) return msg;
      if (tr.status === "claimed" && (tr.claimedByFirstName || "") === name) {
        return msg;
      }
      hit = true;
      return {
        ...msg,
        moneyTransfer: {
          ...tr,
          status: "claimed" as const,
          claimedAt: tr.claimedAt ?? claimedAt,
          claimedByFirstName: name || tr.claimedByFirstName || null,
        },
      };
    });
    if (hit) {
      messagesByKey.set(key, next);
      touched = next;
      if (ownerPhone) persistMessages(ownerPhone, conversationId, next);
    }
  }
  return touched;
}

export function patchMoneyTransfer(
  patch: MoneyUpdatedPatch,
): ChatMessage[] | null {
  const conversationId = String(patch.conversationId ?? "").trim();
  const transferId = String(patch.transferId ?? "").trim();
  if (!conversationId || !transferId) return null;
  const suffix = `::${conversationId}`;
  let touched: ChatMessage[] | null = null;
  for (const [key, items] of messagesByKey) {
    if (!key.endsWith(suffix)) continue;
    let hit = false;
    const next = items.map((msg) => {
      const tr = msg.moneyTransfer;
      if (!tr || tr.transferId !== transferId) return msg;
      const status = String(patch.status ?? tr.status).toLowerCase();
      const nextTr = {
        ...tr,
        status: (status || tr.status) as typeof tr.status,
        claimedAt: patch.claimedAt || tr.claimedAt,
        claimedByFirstName:
          patch.claimedByFirstName || tr.claimedByFirstName || null,
        claimedByUserId: patch.claimedByUserId || tr.claimedByUserId || null,
        thanksFirstName: patch.thanksFirstName || tr.thanksFirstName || null,
        thanksUserId: patch.thanksUserId || tr.thanksUserId || null,
        receiptRequired:
          patch.receiptRequired !== undefined
            ? Boolean(patch.receiptRequired)
            : tr.receiptRequired,
      };
      if (
        nextTr.status === tr.status &&
        nextTr.claimedByUserId === (tr.claimedByUserId ?? null) &&
        nextTr.thanksUserId === (tr.thanksUserId ?? null) &&
        nextTr.claimedByFirstName === (tr.claimedByFirstName ?? null) &&
        nextTr.thanksFirstName === (tr.thanksFirstName ?? null) &&
        Boolean(nextTr.receiptRequired) === Boolean(tr.receiptRequired)
      ) {
        return msg;
      }
      hit = true;
      return {
        ...msg,
        moneyTransfer: applyMoneyReceiptOverride(nextTr),
      };
    });
    if (hit) {
      messagesByKey.set(key, next);
      touched = next;
      if (ownerPhone) persistMessages(ownerPhone, conversationId, next);
    }
  }
  return touched;
}

export function findPeerUserId(conversationId: string): string | null {
  const cid = String(conversationId ?? "").trim();
  if (!cid) return null;
  for (const items of conversationsByOwner.values()) {
    const hit = items.find((c) => c.id === cid);
    if (hit?.peerUserId) return hit.peerUserId;
  }
  return null;
}

/** Une réaction d’un user — fusionne sur la bulle cible (tous les caches du fil). */
export function applyReactionFromSync(
  conversationId: string,
  messageId: string,
  userId: string,
  emoji: string,
): MessageReaction[] | null {
  const cid = String(conversationId ?? "").trim();
  const mid = String(messageId ?? "").trim();
  const uid = String(userId ?? "").trim();
  if (!cid || !mid || !uid) return null;
  const suffix = `::${cid}`;
  let nextReactions: MessageReaction[] | null = null;
  for (const [key, items] of messagesByKey) {
    if (!key.endsWith(suffix)) continue;
    let hit = false;
    const next = items.map((msg) => {
      if (msg.id !== mid) return msg;
      const rest = (msg.reactions ?? []).filter((r) => r.userId !== uid);
      const reactions = emoji ? [...rest, { userId: uid, emoji }] : rest;
      if (reactionsKey(msg.reactions) === reactionsKey(reactions)) return msg;
      hit = true;
      nextReactions = reactions;
      return { ...msg, reactions };
    });
    if (hit) {
      messagesByKey.set(key, next);
      if (ownerPhone) persistMessages(ownerPhone, cid, next);
    }
  }
  return nextReactions;
}

export function patchMessageReactions(
  conversationId: string,
  messageId: string,
  reactions: MessageReaction[],
): ChatMessage[] | null {
  const cid = String(conversationId ?? "").trim();
  const mid = String(messageId ?? "").trim();
  if (!cid || !mid) return null;
  const suffix = `::${cid}`;
  let touched: ChatMessage[] | null = null;
  for (const [key, items] of messagesByKey) {
    if (!key.endsWith(suffix)) continue;
    let hit = false;
    const next = items.map((msg) => {
      if (msg.id !== mid) return msg;
      if (reactionsKey(msg.reactions) === reactionsKey(reactions)) return msg;
      hit = true;
      return { ...msg, reactions };
    });
    if (hit) {
      messagesByKey.set(key, next);
      touched = next;
      if (ownerPhone) persistMessages(ownerPhone, cid, next);
    }
  }
  return touched;
}

export function removeMessageFromSnapshot(
  token: string,
  conversationId: string,
  messageId: string,
): ChatMessage[] | null {
  const cid = String(conversationId ?? "").trim();
  const mid = String(messageId ?? "").trim();
  if (!cid || !mid) return null;
  const key = String(token ?? "").trim();
  if (!key && !ownerPhone) return null;
  const access = key || ownerPhone || "";
  const prev = getMessagesSnapshot(access, cid);
  if (!prev) return null;
  const next = prev.filter((m) => m.id !== mid);
  if (next.length === prev.length) return null;
  setMessagesSnapshot(access, cid, next);
  return next;
}

function tombstoneMessage(msg: ChatMessage): ChatMessage {
  return {
    ...msg,
    type: "text",
    body: null,
    voice: null,
    image: null,
    moneyTransfer: null,
    reactions: [],
    replyTo: null,
    deletedForAll: true,
  };
}

export function patchMessageDeletedForAll(
  conversationId: string,
  messageId: string,
): ChatMessage[] | null {
  const cid = String(conversationId ?? "").trim();
  const mid = String(messageId ?? "").trim();
  if (!cid || !mid) return null;
  const suffix = `::${cid}`;
  let touched: ChatMessage[] | null = null;
  for (const [key, items] of messagesByKey) {
    if (!key.endsWith(suffix)) continue;
    let hit = false;
    const next = items.map((msg) => {
      if (msg.id !== mid) return msg;
      if (msg.deletedForAll) return msg;
      hit = true;
      return tombstoneMessage(msg);
    });
    if (hit) {
      messagesByKey.set(key, next);
      touched = next;
      if (ownerPhone) persistMessages(ownerPhone, cid, next);
    }
  }
  return touched;
}
