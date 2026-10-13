/**
 * File d’attente unique des stops de diffusion — le scan attend la fin
 * avant de relancer (sinon MIUI peut bloquer startDeviceScan).
 */

let stopChain: Promise<void> = Promise.resolve();

export function enqueueBroadcastStop(work: () => Promise<void>): Promise<void> {
  const next = stopChain.then(work, work);
  stopChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function waitTaxiBroadcastStopped(): Promise<void> {
  return stopChain.then(
    () => undefined,
    () => undefined,
  );
}
