/**
 * Ordre après cold start : 1) Pay visible 2) BLE / payer 3) notifs & sync.
 */
import { getAccessToken } from "@/lib/auth/authSession";
import { InteractionManager } from "react-native";

export type PostPayBootPhase = 0 | 1 | 2 | 3;

let phase: PostPayBootPhase = 0;
let bootStarted = false;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function getPostPayBootPhase(): PostPayBootPhase {
  return phase;
}

export function subscribePostPayBoot(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Scan taxi autorisé (Pay affiché, phase ≥ 1). */
export function isPayBleScanAllowed(): boolean {
  return phase >= 1;
}

export function isDeferredBackgroundBootReady(): boolean {
  return phase >= 2;
}

/** Messagerie temps réel — après prefetch onglets (phase 3). */
export function isChatRealtimeBootReady(): boolean {
  return phase >= 3;
}

export function resetPostPayBoot(): void {
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
  phase = 0;
  bootStarted = false;
  emit();
}

function runPhase3(opts?: { token?: string | null; phone?: string | null }): void {
  phase = 3;
  emit();
  const token = opts?.token ?? getAccessToken();
  const phone = opts?.phone ?? undefined;
  void import("@/lib/perf/aggressiveWarm").then((m) => {
    m.runAggressiveWarm({ token, phone: phone ?? undefined });
  });
}

function runPhase2(opts?: { token?: string | null; phone?: string | null }): void {
  phase = 2;
  emit();
  InteractionManager.runAfterInteractions(() => {
    runPhase3(opts);
  });
}

/**
 * Appelé au 1er paint de l’onglet Pay (perso ou caisse).
 */
export function markPayTabFirstPaint(opts?: {
  token?: string | null;
  phone?: string | null;
}): void {
  if (bootStarted) return;
  bootStarted = true;
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }

  requestAnimationFrame(() => {
    phase = 1;
    emit();
    void import("@/lib/ble/warmBroadcast").then((m) => {
      m.warmBleBroadcastRadio();
    });
    InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        runPhase2(opts);
      });
    });
  });
}

/** Si l’utilisateur n’atterrit pas sur Pay (deep link), ne pas bloquer l’app. */
export function schedulePostPayBootFallback(opts: {
  token: string | null;
  phone?: string | null;
  delayMs?: number;
}): () => void {
  if (fallbackTimer) clearTimeout(fallbackTimer);
  if (!opts.token || bootStarted) return () => {};
  const delayMs = opts.delayMs ?? 1200;
  fallbackTimer = setTimeout(() => {
    fallbackTimer = null;
    if (bootStarted) return;
    markPayTabFirstPaint({
      token: opts.token,
      phone: opts.phone ?? undefined,
    });
  }, delayMs);
  return () => {
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
  };
}
