/**
 * Un refus BLE / GPS / « activer Bluetooth » : plus de popup auto.
 * L’app reste utilisable (messages, solde, historique).
 * Un tap sur la pastille taxi relance la demande.
 */

import type { BleScanStatus } from "@/lib/ble/types";

type DeclineStatus = Extract<BleScanStatus, "denied" | "powered_off">;
type ConsentListener = (status: DeclineStatus) => void;

let declined = false;
let lastDecline: DeclineStatus = "denied";
let prepareInFlight: Promise<unknown> | null = null;
const listeners = new Set<ConsentListener>();

export function isBleAutoPromptDeclined(): boolean {
  return declined;
}

export function getBleDeclineStatus(): DeclineStatus {
  return lastDecline;
}

export function markBleAutoPromptDeclined(
  status: DeclineStatus = "denied",
): void {
  declined = true;
  lastDecline = status;
  for (const cb of listeners) cb(status);
}

export function allowBleAutoPromptAgain(): void {
  declined = false;
}

export function subscribeBleConsent(cb: ConsentListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getBlePrepareInFlight(): Promise<unknown> | null {
  return prepareInFlight;
}

export function setBlePrepareInFlight<T>(job: Promise<T>): Promise<T> {
  prepareInFlight = job;
  void job.finally(() => {
    if (prepareInFlight === job) prepareInFlight = null;
  });
  return job;
}
