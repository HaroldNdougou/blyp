import type { ChatMessage } from "@/lib/api/types";
import { resolveTranslateTargetLanguage } from "@/lib/i18n/translateLocale";
import { getDb, runDbWrite } from "@/lib/db/sqlite";
import { getMessagesCacheOwnerPhone } from "@/lib/messagesCache";
import { parseJumboEmojiBody } from "@/lib/messages/jumboEmoji";
import { isReactionSyncBody } from "@/lib/messages/reactionSync";

const ram = new Map<string, string>();

function cacheKey(messageId: string, targetLang: string): string {
  return `${messageId}::${targetLang}`;
}

function kvKey(messageId: string, targetLang: string): string {
  return `msg_tr:${messageId}:${targetLang}`;
}

export function getCachedMessageTranslation(
  messageId: string,
  targetLang: string,
): string | undefined {
  return ram.get(cacheKey(messageId, targetLang));
}

function rememberTranslation(
  messageId: string,
  targetLang: string,
  translated: string,
  phone: string | null,
): void {
  const trimmed = String(translated ?? "").trim();
  if (!trimmed) return;
  ram.set(cacheKey(messageId, targetLang), trimmed);
  if (!phone) return;
  void runDbWrite((db) =>
    db.runAsync(
      `INSERT OR REPLACE INTO kv_cache (phone, key, json) VALUES (?, ?, ?)`,
      phone,
      kvKey(messageId, targetLang),
      JSON.stringify({ text: trimmed }),
    ),
  );
}

export async function warmMessageTranslationsFromSqlite(
  _token: string,
  messageIds: string[],
  targetLang: string,
): Promise<void> {
  const phone = getMessagesCacheOwnerPhone();
  if (!phone || messageIds.length === 0) return;
  const db = await getDb();
  const keys = messageIds.map((id) => kvKey(id, targetLang));
  const placeholders = keys.map(() => "?").join(",");
  const rows = await db.getAllAsync<{ key: string; json: string }>(
    `SELECT key, json FROM kv_cache WHERE phone = ? AND key IN (${placeholders})`,
    phone,
    ...keys,
  );
  for (const row of rows) {
    const parts = row.key.split(":");
    if (parts[0] !== "msg_tr" || parts.length < 3) continue;
    const id = parts[1];
    if (!id) continue;
    try {
      const parsed = JSON.parse(row.json) as { text?: string };
      const text = String(parsed.text ?? "").trim();
      if (text) ram.set(cacheKey(id, targetLang), text);
    } catch {
      /* ignore */
    }
  }
}

export function translatablePeerText(
  msg: ChatMessage,
  mine: boolean,
): string | null {
  if (mine || msg.deletedForAll) return null;
  if (msg.type === "text") {
    if (isReactionSyncBody(msg.body)) return null;
    if (parseJumboEmojiBody(msg.body)) return null;
    const t = String(msg.body ?? "").trim();
    return t || null;
  }
  if (
    msg.type === "image" ||
    msg.type === "document" ||
    msg.type === "money"
  ) {
    const c = String(msg.body ?? "").trim();
    return c || null;
  }
  return null;
}

function sameDisplayText(original: string, translated: string): boolean {
  return original.trim() === translated.trim();
}

export type MessageTranslationDisplay = {
  primary: string;
  original: string;
  showOriginalQuote: boolean;
  showTranslatedBadge: boolean;
};

export function messageTranslationDisplay(
  original: string,
  translated: string | undefined,
  mine: boolean,
): MessageTranslationDisplay {
  const orig = String(original ?? "");
  if (mine || !translated || sameDisplayText(orig, translated)) {
    return {
      primary: orig,
      original: orig,
      showOriginalQuote: false,
      showTranslatedBadge: false,
    };
  }
  return {
    primary: translated,
    original: orig,
    showOriginalQuote: true,
    showTranslatedBadge: true,
  };
}

const BATCH_SIZE = 16;

export async function ensureThreadTranslations(
  token: string,
  conversationId: string,
  messages: ChatMessage[],
  myUserId: string | null,
  onPatch: (patch: Record<string, string>) => void,
): Promise<void> {
  const targetLang = resolveTranslateTargetLanguage();
  const phone = getMessagesCacheOwnerPhone();
  const pending: { id: string; text: string }[] = [];
  const patch: Record<string, string> = {};

  for (const msg of messages) {
    const mine = Boolean(myUserId && msg.senderUserId === myUserId);
    const text = translatablePeerText(msg, mine);
    if (!text) continue;
    const cached = getCachedMessageTranslation(msg.id, targetLang);
    if (cached) {
      if (!sameDisplayText(text, cached)) patch[msg.id] = cached;
      continue;
    }
    pending.push({ id: msg.id, text });
  }

  if (Object.keys(patch).length > 0) onPatch(patch);

  if (pending.length === 0) return;

  const { translateChatMessages } = await import("@/lib/api/client");
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const slice = pending.slice(i, i + BATCH_SIZE);
    try {
      const res = await translateChatMessages(
        token,
        conversationId,
        targetLang,
        slice,
      );
      const batchPatch: Record<string, string> = {};
      for (const row of res.items) {
        const id = String(row.id ?? "").trim();
        const translated = String(row.translatedText ?? "").trim();
        const source = pending.find((p) => p.id === id)?.text ?? "";
        if (!id || !translated) continue;
        rememberTranslation(id, targetLang, translated, phone);
        if (!sameDisplayText(source, translated)) {
          batchPatch[id] = translated;
        }
      }
      if (Object.keys(batchPatch).length > 0) onPatch(batchPatch);
    } catch {
      /* hors-ligne */
    }
  }
}
