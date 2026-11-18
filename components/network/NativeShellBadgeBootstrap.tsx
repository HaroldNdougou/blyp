import { useAuth } from "@/contexts/authContextBase";
import {
  syncNativeShellMessagesUnread,
  syncNativeShellReceiptsUnread,
} from "@/lib/nativeShell";
import { getTotalUnread, subscribeUnread } from "@/lib/messages/unread";
import { persistMessagesUnreadTotal } from "@/lib/messages/messagesUnreadKv";
import {
  getReceiptsUnreadCount,
  hydrateReceiptsUnread,
  subscribeReceiptsUnread,
} from "@/lib/receipts/receiptsUnread";
import { useEffect } from "react";
import { Platform } from "react-native";

/** Badges Messages (tab) + reçus (Profil natif) sync depuis JS. */
export function NativeShellBadgeBootstrap() {
  const { token, user } = useAuth();
  const accountId = String(user?.id ?? "").trim();

  useEffect(() => {
    if (Platform.OS !== "android" || !token) return;
    const pushMessages = () => {
      const n = getTotalUnread();
      syncNativeShellMessagesUnread(n);
      if (accountId) void persistMessagesUnreadTotal(accountId, n);
    };
    pushMessages();
    return subscribeUnread(pushMessages);
  }, [token, accountId]);

  useEffect(() => {
    if (Platform.OS !== "android" || !token || !accountId) return;
    const pushReceipts = () =>
      syncNativeShellReceiptsUnread(getReceiptsUnreadCount(accountId));
    pushReceipts();
    void hydrateReceiptsUnread(accountId).then(pushReceipts);
    return subscribeReceiptsUnread(pushReceipts);
  }, [token, accountId]);

  return null;
}
