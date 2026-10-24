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

/** Jours récents pour le sélecteur (0 = aujourd’hui). */
export function soaRecentDayKeys(count = 14): string[] {
  const keys: string[] = [];
  const base = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    keys.push(soaCommerceDayKey(d));
  }
  return keys;
}
