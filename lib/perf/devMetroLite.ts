/**
 * Dev USB (Metro) : pas de rafale de `import()` au lancement — bundles à la navigation.
 * Release : prefetch agressif inchangé (blyp-perf-light).
 */
export const DEV_METRO_LITE = __DEV__;

/** Délais bootstrap réseau / contacts / WS en dev (ms). */
export const DEV_BACKGROUND_BOOT_MS = __DEV__ ? 45_000 : 0;

export function runAfterDevBackgroundBoot(run: () => void): void {
  if (DEV_BACKGROUND_BOOT_MS > 0) {
    setTimeout(run, DEV_BACKGROUND_BOOT_MS);
  } else {
    run();
  }
}
