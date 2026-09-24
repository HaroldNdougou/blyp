import { useAuth } from "@/contexts/authContextBase";
import {
  openHomeFromPush,
  parsePushData,
  softHydrateAfterPaymentPush,
} from "@/lib/push/handleIncoming";
import {
  isViewingConversation,
  notifyIncomingMessage,
  parseMessagePush,
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
          const message = parseMessagePush(
            notification.request.content.data as Record<string, unknown>,
          );
          if (
            message &&
            isViewingConversation(message.conversationId)
          ) {
            notifyIncomingMessage(message.conversationId, message.messageId);
            return {
              shouldShowAlert: false,
              shouldPlaySound: false,
              shouldSetBadge: false,
              shouldShowBanner: false,
              shouldShowList: false,
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
      return;
    }
    if (registeredFor.current === token) return;

    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        if (cancelled) return;
        void import("@/lib/push/register").then((m) => {
          void m.registerPushToken(token).then((ok) => {
            if (!cancelled && ok) registeredFor.current = token;
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
        const incoming = parseMessagePush(raw);
        if (incoming) {
          notifyIncomingMessage(incoming.conversationId, incoming.messageId);
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
          const incoming = parseMessagePush(raw);
          if (incoming) {
            try {
              router.push(
                `/chat/${encodeURIComponent(incoming.conversationId)}`,
              );
            } catch {
              /* ignore */
            }
            notifyIncomingMessage(incoming.conversationId, incoming.messageId);
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
        const incoming = parseMessagePush(raw);
        if (incoming) {
          const id = last.notification.request.identifier || incoming.messageId;
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
