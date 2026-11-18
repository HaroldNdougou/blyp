import { runRecaps } from "../../lib/adminRecap.mjs";

/**
 * Déclenché chaque jour à 07:00 (heure du Cameroun) par EventBridge.
 *  - récap du jour (veille) : tous les jours ;
 *  - récap hebdo : uniquement le lundi (semaine lundi→dimanche écoulée) ;
 *  - récap mensuel : uniquement le 1er du mois (mois écoulé).
 * Idempotent : un récap déjà envoyé n'est jamais renvoyé (sauf `force` en test manuel).
 */
export async function handler(event = {}) {
  const results = await runRecaps({
    force: event?.force === true,
    only: ["daily", "weekly", "monthly"].includes(event?.only) ? event.only : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(event?.date ?? "")) ? event.date : null,
  });
  console.log("[adminRecap]", JSON.stringify(results));
  return { ok: true, results };
}
