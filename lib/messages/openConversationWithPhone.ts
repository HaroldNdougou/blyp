import { ApiError } from "@/lib/api/errors";
import { ensureSessionFresh, openConversation } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/authSession";
import {
  getConversationsSnapshot,
  getMessagesCacheOwnerPhone,
  setConversationsSnapshot,
} from "@/lib/messagesCache";
import {
  isValidPeerPhoneE164,
  normalizeContactPhoneE164,
} from "@/lib/phone/e164";
import { router } from "expo-router";

export type OpenChatResult =
  | { ok: true; conversationId: string }
  | { ok: false; code: "auth" | "session" | "api" | "generic"; message?: string };

function toE164(phone: string): string | null {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) {
    return isValidPeerPhoneE164(trimmed) ? trimmed : null;
  }
  return normalizeContactPhoneE164(trimmed);
}

export async function openConversationWithPhone(
  phone: string,
): Promise<OpenChatResult> {
  const e164 = toE164(phone);
  if (!e164) {
    return { ok: false, code: "generic" };
  }
  try {
    await ensureSessionFresh();
    const access = getAccessToken();
    if (!access) {
      return { ok: false, code: "auth" };
    }
    const { conversation } = await openConversation(access, e164);
    const prev = getConversationsSnapshot(access) ?? [];
    const next = [conversation, ...prev.filter((c) => c.id !== conversation.id)];
    setConversationsSnapshot(access, next);
    const prefetch = await import("@/lib/messages/prefetchChatThread");
    prefetch.prefetchChatThreadOnPressIn({
      conversationId: conversation.id,
      phone: getMessagesCacheOwnerPhone() ?? "",
      token: access,
    });
    prefetch.markChatOpenOnNavigate();
    router.replace(`/chat/${encodeURIComponent(conversation.id)}`);
    return { ok: true, conversationId: conversation.id };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      return { ok: false, code: "session" };
    }
    if (
      e instanceof ApiError &&
      e.status > 0 &&
      e.status < 500 &&
      e.message.trim() &&
      !/^session invalide$/i.test(e.message.trim())
    ) {
      return { ok: false, code: "api", message: e.message.trim() };
    }
    return { ok: false, code: "generic" };
  }
}
