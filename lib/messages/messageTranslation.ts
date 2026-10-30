import type { ChatMessage } from "@/lib/api/types";
import { parseAmountFcfa } from "@/lib/amountLimits";
import { resolveTranslateTargetLanguage } from "@/lib/i18n/translateLocale";
import { runDbRead, runDbWrite } from "@/lib/db/sqlite";
import { getMessagesCacheOwnerPhone } from "@/lib/messagesCache";
import { parseJumboEmojiBody } from "@/lib/messages/jumboEmoji";
import { isReactionSyncBody } from "@/lib/messages/reactionSync";
import { isChatMessageMine } from "@/lib/messages/messageMine";

const ram = new Map<string, string>();

function cacheKey(storageKey: string, targetLang: string): string {
  return `${storageKey}::${targetLang}`;
}

function kvKey(storageKey: string, targetLang: string): string {
  return `msg_tr:${storageKey}:${targetLang}`;
}

function storageKeyFromKvRow(
  rowKey: string,
  targetLang: string,
): string | null {
  const prefix = "msg_tr:";
  if (!rowKey.startsWith(prefix)) return null;
  const tail = rowKey.slice(prefix.length);
  const langSuffix = `:${targetLang}`;
  if (!tail.endsWith(langSuffix)) return null;
  const storageKey = tail.slice(0, -langSuffix.length);
  return storageKey || null;
}

/** Clé RAM / SQLite / état UI — légende seule pour les messages money. */
export function messageTranslationStorageKey(
  msg: Pick<ChatMessage, "id" | "type">,
): string {
  return msg.type === "money" ? `${msg.id}::caption` : msg.id;
}

/** Montant / pseudo-montant dans body : ne pas traduire ni afficher comme légende. */
export function isLikelyMoneyAmountCaption(
  caption: string,
  amountFcfa: number | undefined,
): boolean {
  const c = String(caption ?? "").trim();
  if (!c) return true;
  if (/^\s*[\d\s.]+\s*(?:fcfa|cfa|f)\s*$/i.test(c)) return true;
  const digits = c.replace(/[^\d]/g, "");
  const parsed = parseAmountFcfa(digits);
  if (
    parsed != null &&
    amountFcfa != null &&
    parsed === amountFcfa &&
    digits.length > 0
  ) {
    return true;
  }
  return false;
}

export function getCachedMessageTranslation(
  storageKey: string,
  targetLang: string,
): string | undefined {
  return ram.get(cacheKey(storageKey, targetLang));
}

function rememberTranslation(
  storageKey: string,
  targetLang: string,
  translated: string,
  phone: string | null,
): void {
  const trimmed = String(translated ?? "").trim();
  if (!trimmed) return;
  ram.set(cacheKey(storageKey, targetLang), trimmed);
  if (!phone) return;
  void runDbWrite((db) =>
    db.runAsync(
      `INSERT OR REPLACE INTO kv_cache (phone, key, json) VALUES (?, ?, ?)`,
      phone,
      kvKey(storageKey, targetLang),
      JSON.stringify({ text: trimmed }),
    ),
  ).catch(() => {});
}

export async function warmMessageTranslationsFromSqlite(
  _token: string,
  messages: ChatMessage[],
  targetLang: string,
): Promise<void> {
  const phone = getMessagesCacheOwnerPhone();
  if (!phone || messages.length === 0) return;
  const storageKeys = messages.map((m) => messageTranslationStorageKey(m));
  await runDbRead(async (db) => {
    const keys = storageKeys.map((sk) => kvKey(sk, targetLang));
    const placeholders = keys.map(() => "?").join(",");
    const rows = await db.getAllAsync<{ key: string; json: string }>(
      `SELECT key, json FROM kv_cache WHERE phone = ? AND key IN (${placeholders})`,
      phone,
      ...keys,
    );
    for (const row of rows) {
      const storageKey = storageKeyFromKvRow(row.key, targetLang);
      if (!storageKey) continue;
      try {
        const parsed = JSON.parse(row.json) as { text?: string };
        const text = String(parsed.text ?? "").trim();
        if (text) ram.set(cacheKey(storageKey, targetLang), text);
      } catch {
        /* ignore */
      }
    }
    // Anciennes entrées (money traduit sur msg.id) — ignorer volontairement.
  });
}

export function translatablePeerText(
  msg: ChatMessage,
  myUserId: string | null,
): string | null {
  if (isChatMessageMine(msg, myUserId) || msg.deletedForAll) return null;
  if (msg.type === "text") {
    if (isReactionSyncBody(msg.body)) return null;
    if (parseJumboEmojiBody(msg.body)) return null;
    const t = String(msg.body ?? "").trim();
    return t || null;
  }
  if (
    msg.type === "image" ||
    msg.type === "document"
  ) {
    const c = String(msg.body ?? "").trim();
    return c || null;
  }
  if (msg.type === "money") {
    const c = String(msg.body ?? "").trim();
    if (!c) return null;
    if (isLikelyMoneyAmountCaption(c, msg.moneyTransfer?.amountFcfa)) {
      return null;
    }
    return c;
  }
  return null;
}

function sameDisplayText(original: string, translated: string): boolean {
  return original.trim() === translated.trim();
}

function normalizeLangCode(code: string | null | undefined): string {
  return String(code ?? "")
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
}

function shouldApplyTranslation(
  original: string,
  translated: string,
  sourceLanguage: string | null | undefined,
  targetLanguage: string,
): boolean {
  if (!translated.trim() || sameDisplayText(original, translated)) {
    return false;
  }
  const src = normalizeLangCode(sourceLanguage);
  const tgt = normalizeLangCode(targetLanguage);
  if (src && tgt && src === tgt) return false;
  return true;
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
  const pending: { apiId: string; storageKey: string; text: string }[] = [];
  const patch: Record<string, string> = {};

  for (const msg of messages) {
    const text = translatablePeerText(msg, myUserId);
    if (!text) continue;
    const storageKey = messageTranslationStorageKey(msg);
    const cached = getCachedMessageTranslation(storageKey, targetLang);
    if (cached) {
      if (!sameDisplayText(text, cached)) patch[storageKey] = cached;
      continue;
    }
    pending.push({ apiId: msg.id, storageKey, text });
  }

  if (Object.keys(patch).length > 0) onPatch(patch);

  if (pending.length === 0) return;

  const { translateChatMessages } = await import("@/lib/api/client");
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const slice = pending.slice(i, i + BATCH_SIZE);
    const apiItems = slice.map((p) => ({ id: p.apiId, text: p.text }));
    try {
      const res = await translateChatMessages(
        token,
        conversationId,
        targetLang,
        apiItems,
      );
      const batchPatch: Record<string, string> = {};
      for (const row of res.items) {
        const apiId = String(row.id ?? "").trim();
        const translated = String(row.translatedText ?? "").trim();
        const pendingRow = pending.find((p) => p.apiId === apiId);
        const original = pendingRow?.text ?? "";
        const storageKey = pendingRow?.storageKey ?? apiId;
        const sourceLanguage =
          (row as { sourceLanguage?: string | null }).sourceLanguage ?? null;
        if (!apiId || !translated) continue;
        if (
          !shouldApplyTranslation(
            original,
            translated,
            sourceLanguage,
            res.targetLanguage ?? targetLang,
          )
        ) {
          continue;
        }
        rememberTranslation(storageKey, targetLang, translated, phone);
        batchPatch[storageKey] = translated;
      }
      if (Object.keys(batchPatch).length > 0) onPatch(batchPatch);
    } catch (err) {
      if (__DEV__) {
        console.warn("[messageTranslation] batch failed", err);
      }
    }
  }
}
