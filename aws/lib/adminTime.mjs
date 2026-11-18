/**
 * Calendrier métier Blyp : Cameroun (Africa/Douala, UTC+1, sans heure d'été).
 * Toutes les « journées » des statistiques sont des journées locales camerounaises.
 */

export const TZ_OFFSET_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** `2026-11-18` — journée locale d'un instant (ms epoch). */
export function dayKey(ms) {
  return new Date(Number(ms) + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** `2026-11` */
export function monthKey(ms) {
  return dayKey(ms).slice(0, 7);
}

function dayToUtcMs(day) {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/** Ajoute `n` jours (négatif possible) à une clé journée. */
export function shiftDay(day, n) {
  return new Date(dayToUtcMs(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Nombre de jours entre deux clés (b - a). */
export function daysBetween(a, b) {
  return Math.round((dayToUtcMs(b) - dayToUtcMs(a)) / DAY_MS);
}

/** Lundi de la semaine locale contenant `ms` (clé de semaine ISO-like). */
export function weekKey(ms) {
  const day = dayKey(ms);
  const dow = new Date(dayToUtcMs(day)).getUTCDay(); // 0 = dimanche
  const sinceMonday = (dow + 6) % 7;
  return shiftDay(day, -sinceMonday);
}

/** Liste de jours consécutifs [from..to] inclus. */
export function dayRange(from, to) {
  const out = [];
  let d = from;
  let guard = 0;
  while (d <= to && guard++ < 1200) {
    out.push(d);
    d = shiftDay(d, 1);
  }
  return out;
}

/** Premier / dernier jour du mois `YYYY-MM`. */
export function monthBounds(month) {
  const from = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from, to: shiftDay(next, -1) };
}

/** Mois précédent de `YYYY-MM`. */
export function prevMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function pad13(ms) {
  return String(Math.floor(Number(ms))).padStart(13, "0");
}
