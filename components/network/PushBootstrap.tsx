import { useAuth } from "@/contexts/authContextBase";
import {
  openHomeFromPush,
  parsePushData,
  softHydrateAfterPaymentPush,
} from "@/lib/push/handleIncoming";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import {
  AppState,
  InteractionManager,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from "react-native";

import { DEV_BACKGROUND_BOOT_MS } from "@/lib/perf/devMetroLite";

const BOOT_DELAY_MS = DEV_BACKGROUND_BOOT_MS > 0 ? DEV_BACKGROUND_BOOT_MS : 400;

/**
 * Push Expo — paiements wallet uniquement (MVP sans messagerie).
 */
export function PushBootstrap() {
  const { token, user, refreshUser, applyIncomingPayment } = useAuth();
  const phone = user?.phone ?? "";
  const router = useRouter();
  const registeredFor = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") return;
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
    const announceTimer = setTimeout(() => {
      InteractionManager.runAfterInteractions(() => {
        void import("@/lib/push/announcePref").then((m) => {
          void m.hydrateAnnouncePaymentsPref().then((on) => {
            if (!on) return;
            void Promise.all([
              import("@/lib/push/announceNative"),
              import("@/lib/push/announcePayment"),
              import("expo-speech"),
              import("expo-av"),
            ]);
          });
        });
      });
    }, BOOT_DELAY_MS);
    return () => {
      clearTimeout(announceTimer);
      paySub?.remove();
    };
  }, [token, phone, refreshUser, applyIncomingPayment]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    let cancelled = false;
    const bootTimer = setTimeout(() => {
      void import("expo-notifications").then((Notifications) => {
        if (cancelled) return;
        Notifications.setNotificationHandler({
          handleNotification: async (notification) => {
            const raw = notification.request.content.data as Record<
              string,
              unknown
            >;
            const data = parsePushData(raw);
            if (data) {
              return {
                shouldShowAlert: true,
                shouldPlaySound: true,
                shouldSetBadge: false,
                shouldShowBanner: true,
                shouldShowList: true,
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
    }, BOOT_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(bootTimer);
    };
  }, []);

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

    const bootTimer = setTimeout(() => {
      void import("expo-notifications").then((Notifications) => {
        if (cancelled) return;

        subReceived = Notifications.addNotificationReceivedListener((n) => {
          const raw = n.request.content.data as Record<string, unknown>;
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

        void Notifications.getLastNotificationResponseAsync().then(
          async (last) => {
            if (cancelled || !last) return;
            const raw = last.notification.request.content.data as Record<
              string,
              unknown
            >;
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
              /* ignore */
            }
            if (cancelled) return;
            applyIncomingPayment(data);
            openHomeFromPush(router);
            softHydrateAfterPaymentPush({ token, phone, refreshUser });
          },
        );
      });
    }, BOOT_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(bootTimer);
      subReceived?.remove();
      subResponse?.remove();
    };
  }, [token, phone, refreshUser, applyIncomingPayment, router]);

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
