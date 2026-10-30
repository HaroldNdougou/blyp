const REPORT_TZ = "Africa/Douala";

/** Clé jour `YYYY-MM-DD` (fuseau Douala, aligné serveur). */
export function soaCommerceDayKey(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Clé jour Douala pour un horodatage transaction / API. */
export function soaCommerceDayKeyFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return soaCommerceDayKey(d);
}

/** Décale une clé jour (calendrier Douala, midi local). */
export function soaShiftDayKey(dayKey: string, deltaDays: number): string {
  const ms =
    Date.parse(`${String(dayKey).trim()}T12:00:00+01:00`) +
    deltaDays * 86_400_000;
  return soaCommerceDayKey(new Date(ms));
}

/** Jours récents pour le sélecteur (0 = aujourd’hui), 14 clés uniques. */
export function soaRecentDayKeys(count = 14): string[] {
  const keys: string[] = [];
  let dk = soaCommerceDayKey();
  for (let i = 0; i < count; i++) {
    keys.push(dk);
    dk = soaShiftDayKey(dk, -1);
  }
  return keys;
}
