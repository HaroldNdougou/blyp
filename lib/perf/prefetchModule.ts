/**
 * Prefetch Metro (import dynamique) — jamais de rejet non géré :
 * en dev, hors ligne = LoadBundleFromServerRequestError sans .catch() → RedBox.
 */
export function prefetchModule(loader: () => Promise<unknown>): void {
  void loader().catch(() => {
    /* chunk Metro — retry à la prochaine nav / reconnect */
  });
}

export function prefetchModuleThen<T>(
  loader: () => Promise<T>,
  run: (mod: T) => void | Promise<void>,
): void {
  void loader()
    .then((mod) => {
      void Promise.resolve(run(mod)).catch(() => {});
    })
    .catch(() => {});
}
