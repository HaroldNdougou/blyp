/**
 * Bundle release îlot Messages : remplace `aggressiveWarm` / `floodAllTabs`
 * (Pay, Historique, Profil = coque native — rien à préchauffer côté RN).
 */
export function runAggressiveWarm(_opts: {
  token: string | null;
  phone?: string;
}): void {}

export function resetAggressiveWarm(): void {}

export function floodAllTabs(_token: string | null): void {}
