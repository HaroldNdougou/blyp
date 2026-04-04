import { IslandToastHost } from "@/components/IslandToastHost";
import type { IslandToastItem } from "@/components/IslandToastHost";
import { useAuth } from "@/contexts/AuthContext";
import { markNotificationRead } from "@/lib/api/client";
import type { ApiToastPayload } from "@/lib/api/types";
import type { ShowToastOptions } from "@/lib/inAppToast";
import { toastOptionsFromApi } from "@/lib/inAppToast";
import * as Haptics from "expo-haptics";
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";

const DEFAULT_DURATION_MS = 4_600;

type InternalToast = ShowToastOptions & { id: string };

type ToastContextValue = {
  showToast: (opts: ShowToastOptions) => void;
  showToastFromApi: (
    payload: ApiToastPayload,
    variant?: IslandToastItem["variant"],
  ) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export type { ShowToastOptions } from "@/lib/inAppToast";
export type { ToastVariant } from "@/lib/inAppToast";

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const queueRef = useRef<InternalToast[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const activeRef = useRef<InternalToast | null>(null);
  const [active, setActive] = useState<IslandToastItem | null>(null);

  const pump = useCallback(() => {
    if (activeIdRef.current != null) return;
    const next = queueRef.current.shift();
    if (!next) return;
    activeIdRef.current = next.id;
    activeRef.current = next;
    const variant = next.variant ?? "success";
    if (variant === "success") {
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
    } else if (variant === "warning" || variant === "error") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setActive({
      id: next.id,
      title: next.title,
      message: next.message,
      emoji: next.emoji,
      variant,
      durationMs: next.durationMs ?? DEFAULT_DURATION_MS,
      notificationId: next.notificationId,
    });
  }, []);

  const onHostFinished = useCallback(() => {
    const done = activeRef.current;
    activeRef.current = null;
    activeIdRef.current = null;
    setActive(null);
    if (done?.notificationId && token) {
      void markNotificationRead(token, done.notificationId).catch(() => {});
    }
    setTimeout(() => pump(), 48);
  }, [token, pump]);

  const showToast = useCallback(
    (opts: ShowToastOptions) => {
      const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      queueRef.current.push({ ...opts, id });
      if (activeIdRef.current == null) pump();
    },
    [pump],
  );

  const showToastFromApi = useCallback(
    (payload: ApiToastPayload, variant?: IslandToastItem["variant"]) => {
      showToast(toastOptionsFromApi(payload, variant ?? "success"));
    },
    [showToast],
  );

  const value = useMemo(
    () => ({ showToast, showToastFromApi }),
    [showToast, showToastFromApi],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <View pointerEvents="box-none" style={styles.overlay}>
        <IslandToastHost item={active} onFinished={onHostFinished} />
      </View>
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50_000,
    elevation: 50_000,
  },
});

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast doit être utilisé dans un ToastProvider");
  }
  return ctx;
}
