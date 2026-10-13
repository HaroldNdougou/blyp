import { useAuth } from "@/contexts/authContextBase";
import {
  openHomeFromPush,
  parsePushData,
  softHydrateAfterPaymentPush,
} from "@/lib/push/handleIncoming";
import {
  ingestIncomingPush,
  ingestSilentChatPush,
  isViewingConversation,
  notifyConversationReceipt,
  notifyMessageDeleted,
  notifyMessageReaction,
  notifyMoneyClaimed,
  notifyMoneyTray,
  parseConversationReceiptPush,
  parseMessagePush,
  parseMessageDeletedPush,
  parseMessageReactionPush,
  parseMoneyClaimedPush,
  parseMoneyTrayPush,
  startMessageLiveBridge,
} from "@/lib/messages/live";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import {
  AppState,
  InteractionManager,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from "react-native";

const BOOT_DELAY_MS = 400;

/**
 * Push Expo — bootstrap après interactions (jamais splash).
 * Réception soft : hydrate cache ; tap → home.
 */
export function PushBootstrap() {
  const { token, user, refreshUser, applyIncomingPayment } = useAuth();
  const phone = user?.phone ?? "";
  const router = useRouter();
  const registeredFor = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") return;
    startMessageLiveBridge();
    const payMod = (
      NativeModules as { BlypPaymentAnnounce?: object }
    ).BlypPaymentAnnounce;
    let paySub: { remove: () => void } | undefined;
    if (payMod) {
      paySub = new NativeEventEmitter(payMod as never).addListener(
        "blyp_payment_received",
        (raw: Record<string, unknown>) => {
          const data = parsePushData(raw);
          if (!data) return;
          applyIncomingPayment(data);
          softHydrateAfterPaymentPush({ token, phone, refreshUser });
        },
      );
    }
    /** Pref annonce — hydrate RAM après frame, jamais splash. */
    InteractionManager.runAfterInteractions(() => {
      void import("@/lib/push/announcePref").then((m) => {
        void m.hydrateAnnouncePaymentsPref().then((on) => {
          if (!on) return;
          /** Pré-charge TTS + cash — 1er paiement sans cold import au push. */
          void Promise.all([
            import("@/lib/push/announceNative"),
            import("@/lib/push/announcePayment"),
            import("expo-speech"),
            import("expo-av"),
          ]);
        });
      });
    });
    return () => {
      paySub?.remove();
    };
  }, [token, phone, refreshUser, applyIncomingPayment]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    let cancelled = false;
    void import("expo-notifications").then((Notifications) => {
      if (cancelled) return;
      Notifications.setNotificationHandler({
        handleNotification: async (notification) => {
          const raw = notification.request.content.data as Record<
            string,
            unknown
          >;
          if (ingestSilentChatPush(raw)) {
            return {
              shouldShowAlert: false,
              shouldPlaySound: false,
              shouldSetBadge: false,
              shouldShowBanner: false,
              shouldShowList: false,
            };
          }
          const tray = parseMoneyTrayPush(raw);
          if (tray && tray.kind !== "claimed") {
            notifyMoneyTray(tray);
            const hide =
              Platform.OS === "android" ||
              isViewingConversation(tray.conversationId);
            return {
              shouldShowAlert: !hide,
              shouldPlaySound: !hide,
              shouldSetBadge: false,
              shouldShowBanner: !hide,
              shouldShowList: !hide,
            };
          }
          const claimed = parseMoneyClaimedPush(raw);
          if (claimed) {
            notifyMoneyClaimed(claimed);
            const hide =
              Platform.OS === "android" ||
              isViewingConversation(claimed.conversationId);
            return {
              shouldShowAlert: !hide,
              shouldPlaySound: !hide,
              shouldSetBadge: false,
              shouldShowBanner: !hide,
              shouldShowList: !hide,
            };
          }
          const receipt = parseConversationReceiptPush(raw);
          if (receipt) {
            notifyConversationReceipt(receipt);
            return {
              shouldShowAlert: false,
              shouldPlaySound: false,
              shouldSetBadge: false,
              shouldShowBanner: false,
              shouldShowList: false,
            };
          }
          const reaction = parseMessageReactionPush(raw);
          if (reaction) {
            notifyMessageReaction(reaction);
            return {
              shouldShowAlert: false,
              shouldPlaySound: false,
              shouldSetBadge: false,
              shouldShowBanner: false,
              shouldShowList: false,
            };
          }
          const deleted = parseMessageDeletedPush(raw);
          if (deleted) {
            notifyMessageDeleted(deleted);
            return {
              shouldShowAlert: false,
              shouldPlaySound: false,
              shouldSetBadge: false,
              shouldShowBanner: false,
              shouldShowList: false,
            };
          }
          const message = parseMessagePush(raw);
          if (message) {
            ingestIncomingPush(raw);
            const hide =
              message.silent || isViewingConversation(message.conversationId);
            return {
              shouldShowAlert: !hide,
              shouldPlaySound: !hide,
              shouldSetBadge: false,
              shouldShowBanner: !hide,
              shouldShowList: !hide,
            };
          }
          return {
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
            shouldShowBanner: true,
            shouldShowList: true,
          };
        },
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  /** Enregistrement token — dès session (pas bloqué par onboarding). */
  useEffect(() => {
    if (!token) {
      registeredFor.current = null;
      void import("@/lib/contacts/postLoginBootstrap").then((m) => {
        m.resetPostLoginBootstrap();
      });
      void import("@/lib/contacts/permissions").then((m) => {
        m.resetContactsPermissionSession();
      });
      return;
    }

    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        if (cancelled) return;
        void import("@/lib/contacts/postLoginBootstrap").then((m) => {
          void m.runPostLoginBootstrap(token).then(() => {
            if (!cancelled) registeredFor.current = token;
          });
        });
      }, BOOT_DELAY_MS);
    });

    return () => {
      cancelled = true;
      task.cancel?.();
    };
  }, [token]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;
    let subReceived: { remove: () => void } | undefined;
    let subResponse: { remove: () => void } | undefined;

    void import("expo-notifications").then((Notifications) => {
      if (cancelled) return;

      subReceived = Notifications.addNotificationReceivedListener((n) => {
        const raw = n.request.content.data as Record<string, unknown>;
        if (ingestSilentChatPush(raw)) return;
        const tray = parseMoneyTrayPush(raw);
        if (tray && tray.kind !== "claimed") {
          notifyMoneyTray(tray);
          return;
        }
        const claimed = parseMoneyClaimedPush(raw);
        if (claimed) {
          notifyMoneyClaimed(claimed);
          return;
        }
        const receipt = parseConversationReceiptPush(raw);
        if (receipt) {
          notifyConversationReceipt(receipt);
          return;
        }
        const reaction = parseMessageReactionPush(raw);
        if (reaction) {
          notifyMessageReaction(reaction);
          return;
        }
        const deletedMsg = parseMessageDeletedPush(raw);
        if (deletedMsg) {
          notifyMessageDeleted(deletedMsg);
          return;
        }
        const incoming = parseMessagePush(raw);
        if (incoming) {
          ingestIncomingPush(raw);
          return;
        }
        const data = parsePushData(raw);
        if (!data) return;
        applyIncomingPayment(data);
        softHydrateAfterPaymentPush({ token, phone, refreshUser });
        void import("@/lib/push/announcePayment").then((m) => {
          void m.maybeAnnouncePaymentReceived(data);
        });
      });

      subResponse = Notifications.addNotificationResponseReceivedListener(
        (response) => {
          const raw = response.notification.request.content.data as Record<
            string,
            unknown
          >;
          if (ingestSilentChatPush(raw)) return;
          const trayTap = parseMoneyTrayPush(raw);
          if (trayTap && trayTap.kind !== "claimed") {
            notifyMoneyTray(trayTap);
            try {
              router.push({
                pathname: "/chat/[id]",
                params: {
                  id: trayTap.conversationId,
                  transferId: trayTap.transferId,
                },
              });
            } catch {
              /* ignore */
            }
            return;
          }
          const claimedTap = parseMoneyClaimedPush(raw);
          if (claimedTap) {
            notifyMoneyClaimed(claimedTap);
            try {
              router.push({
                pathname: "/chat/[id]",
                params: {
                  id: claimedTap.conversationId,
                  transferId: claimedTap.transferId,
                },
              });
            } catch {
              /* ignore */
            }
            return;
          }
          const receiptTap = parseConversationReceiptPush(raw);
          if (receiptTap) {
            notifyConversationReceipt(receiptTap);
            return;
          }
          const reactionTap = parseMessageReactionPush(raw);
          if (reactionTap) {
            notifyMessageReaction(reactionTap);
            return;
          }
          const deletedTap = parseMessageDeletedPush(raw);
          if (deletedTap) {
            notifyMessageDeleted(deletedTap);
            return;
          }
          const incoming = parseMessagePush(raw);
          if (incoming) {
            ingestIncomingPush(raw);
            try {
              router.push(
                `/chat/${encodeURIComponent(incoming.conversationId)}`,
              );
            } catch {
              /* ignore */
            }
            return;
          }
          const data = parsePushData(raw);
          if (!data) return;
          applyIncomingPayment(data);
          openHomeFromPush(router);
          softHydrateAfterPaymentPush({ token, phone, refreshUser });
          void import("@/lib/push/announcePayment").then((m) => {
            void m.maybeAnnouncePaymentReceived(data);
          });
        },
      );

      void Notifications.getLastNotificationResponseAsync().then(async (last) => {
        if (cancelled || !last) return;
        const raw = last.notification.request.content.data as Record<
          string,
          unknown
        >;
        const trayOpen = parseMoneyTrayPush(raw);
        if (trayOpen && trayOpen.kind !== "claimed") {
          const id =
            last.notification.request.identifier ||
            `${trayOpen.kind}:${trayOpen.transferId}`;
          try {
            const SecureStore = await import("expo-secure-store");
            const key = "blyp_push_last_response";
            const prev = await SecureStore.getItemAsync(key);
            if (prev === id) return;
            await SecureStore.setItemAsync(key, id);
          } catch {
            /* ignore */
          }
          if (cancelled) return;
          notifyMoneyTray(trayOpen);
          try {
            router.push({
              pathname: "/chat/[id]",
              params: {
                id: trayOpen.conversationId,
                transferId: trayOpen.transferId,
              },
            });
          } catch {
            /* ignore */
          }
          return;
        }
        const claimedOpen = parseMoneyClaimedPush(raw);
        if (claimedOpen) {
          const id =
            last.notification.request.identifier || claimedOpen.transferId;
          try {
            const SecureStore = await import("expo-secure-store");
            const key = "blyp_push_last_response";
            const prev = await SecureStore.getItemAsync(key);
            if (prev === id) return;
            await SecureStore.setItemAsync(key, id);
          } catch {
            /* ignore */
          }
          if (cancelled) return;
          notifyMoneyClaimed(claimedOpen);
          try {
            router.push({
              pathname: "/chat/[id]",
              params: {
                id: claimedOpen.conversationId,
                transferId: claimedOpen.transferId,
              },
            });
          } catch {
            /* ignore */
          }
          return;
        }
        const incoming = parseMessagePush(raw);
        if (incoming) {
          const id = last.notification.request.identifier || incoming.messageId;
          ingestIncomingPush(raw);
          try {
            const SecureStore = await import("expo-secure-store");
            const key = "blyp_push_last_response";
            const prev = await SecureStore.getItemAsync(key);
            if (prev === id) return;
            await SecureStore.setItemAsync(key, id);
          } catch {
            /* ignore */
          }
          if (cancelled) return;
          try {
            router.push(
              `/chat/${encodeURIComponent(incoming.conversationId)}`,
            );
          } catch {
            /* ignore */
          }
          return;
        }
        const data = parsePushData(raw);
        if (!data) return;
        const id =
          last.notification.request.identifier ||
          String(data.transactionId ?? "");
        try {
          const SecureStore = await import("expo-secure-store");
          const key = "blyp_push_last_response";
          const prev = await SecureStore.getItemAsync(key);
          if (prev === id) return;
          await SecureStore.setItemAsync(key, id);
        } catch {
          /* ignore dedupe failure */
        }
        if (cancelled) return;
        applyIncomingPayment(data);
        openHomeFromPush(router);
        softHydrateAfterPaymentPush({ token, phone, refreshUser });
      });
    });

    return () => {
      cancelled = true;
      subReceived?.remove();
      subResponse?.remove();
    };
  }, [token, phone, refreshUser, applyIncomingPayment, router]);

  /** Re-register au retour foreground (token FCM parfois rotaté). */
  useEffect(() => {
    if (!token) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      InteractionManager.runAfterInteractions(() => {
        void import("@/lib/push/register").then((m) => {
          void m.registerPushToken(token).then((ok) => {
            if (ok) registeredFor.current = token;
          });
        });
      });
    });
    return () => sub.remove();
  }, [token]);

  return null;
}
