import { escapeHtml as e, fcfa } from "../../lib/adminNotify.mjs";
import { daysBetween } from "../../lib/adminTime.mjs";

const num = (v) => (Number(v) || 0).toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, " ");
const pct = (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1).replace(".", ",")} %`);
const frDate = (d) => d.split("-").reverse().join("/");

function kpi(label, value, sub = "") {
  return `<div class="kpi"><div class="kpi-v">${e(value)}</div><div class="kpi-l">${e(label)}</div>${
    sub ? `<div class="kpi-s">${e(sub)}</div>` : ""
  }</div>`;
}

/** Rapport imprimable (Ctrl+P → PDF) pour data room / investisseurs. */
export function renderInvestorReport({ nonce, overview, monthly, cohorts }) {
  const t = overview.totals;
  const a = overview.actives;
  const generated = overview.generatedAt.replace("T", " ").slice(0, 16);

  const monthlyRows = monthly
    .map(
      (m) => `<tr><td>${e(m.month)}</td><td class="r">${num(m.newUsers)}</td><td class="r">${num(m.mau)}</td>
<td class="r">${num(m.txCount)}</td><td class="r">${num(m.gmvFcfa)}</td><td class="r">${num(m.avgTicketFcfa)}</td>
<td class="r">${num(m.depositVolumeFcfa)}</td><td class="r">${num(m.messages)}</td></tr>`,
    )
    .join("");

  const today = overview.day;
  const cohortRows = cohorts
    .filter((c) => c.size > 0)
    .slice(-30)
    .map((c) => {
      const age = daysBetween(c.day, today);
      const cell = (n, d) => (age >= d ? pct(c.size ? n / c.size : null) : "—");
      return `<tr><td>${e(frDate(c.day))}</td><td class="r">${num(c.size)}</td><td class="r">${cell(c.d1, 1)}</td><td class="r">${cell(c.d7, 7)}</td><td class="r">${cell(c.d30, 30)}</td></tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Blyp — Rapport investisseur</title>
<style nonce="${nonce}">
*{box-sizing:border-box}body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827;margin:0;background:#f3f4f6}
.page{max-width:900px;margin:0 auto;padding:24px;background:#fff}
h1{margin:0 0 4px;font-size:26px}h2{font-size:17px;margin:28px 0 10px;border-bottom:2px solid #5dc705;padding-bottom:4px}
.muted{color:#6b7280;font-size:13px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.kpi{border:1px solid #e5e7eb;border-radius:10px;padding:12px}.kpi-v{font-size:22px;font-weight:700}
.kpi-l{font-size:12px;color:#6b7280;margin-top:2px}.kpi-s{font-size:11px;color:#9ca3af;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:12.5px}th,td{padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:left}
th{background:#f9fafb;font-weight:600}.r{text-align:right}
ul{font-size:12.5px;color:#374151;padding-left:18px}li{margin:3px 0}
.btn{background:#111827;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer;margin-bottom:12px}
@media print{body{background:#fff}.page{padding:0}.btn{display:none}h2{break-after:avoid}table,.kpi{break-inside:avoid}}
</style></head><body><div class="page">
<button class="btn" id="print">Imprimer / enregistrer en PDF</button>
<h1>Blyp — Rapport d'activité</h1>
<div class="muted">Généré le ${e(generated)} UTC · fuseau de référence : Cameroun (UTC+1) · données issues du journal d'événements Blyp</div>

<h2>Indicateurs clés (cumul depuis le suivi)</h2>
<div class="grid">
${kpi("Utilisateurs inscrits", num(t.users), `${num(t.deletedUsers)} comptes supprimés`)}
${kpi("Taux d'activation", pct(overview.activationRate), "≥ 1 paiement commerçant")}
${kpi("Volume échangé (GMV)", fcfa(t.gmvFcfa))}
${kpi("Transactions", num(t.txCount))}
${kpi("Recharges", fcfa(t.depositVolumeFcfa))}
${kpi("Retraits", fcfa(t.withdrawalVolumeFcfa))}
${kpi("Commerçants ayant encaissé", num(t.payingMerchants))}
${kpi("Messages échangés", num(t.messages))}
</div>

<h2>Engagement (période en cours)</h2>
<div class="grid">
${kpi("Actifs aujourd'hui (DAU)", num(a.dau))}
${kpi("Actifs 7 jours (WAU)", num(a.wau), "semaine en cours")}
${kpi("Actifs du mois (MAU)", num(a.mau), overview.month.key)}
${kpi("Stickiness DAU/MAU", pct(a.stickiness))}
${kpi("Nouveaux — 7 derniers jours", num(overview.last7.newUsers))}
${kpi("GMV — 7 derniers jours", fcfa(overview.last7.gmvFcfa))}
${kpi("Nouveaux — 30 derniers jours", num(overview.last30.newUsers))}
${kpi("GMV — 30 derniers jours", fcfa(overview.last30.gmvFcfa))}
</div>

<h2>Évolution mensuelle</h2>
<table><thead><tr><th>Mois</th><th class="r">Inscrits</th><th class="r">Actifs (MAU)</th><th class="r">Transactions</th><th class="r">GMV (FCFA)</th><th class="r">Ticket moyen</th><th class="r">Recharges (FCFA)</th><th class="r">Messages</th></tr></thead>
<tbody>${monthlyRows || '<tr><td colspan="8">Pas encore de données.</td></tr>'}</tbody></table>

<h2>Rétention par cohorte d'inscription</h2>
<table><thead><tr><th>Cohorte (jour d'inscription)</th><th class="r">Taille</th><th class="r">J+1</th><th class="r">J+7</th><th class="r">J+30</th></tr></thead>
<tbody>${cohortRows || '<tr><td colspan="5">Pas encore de cohorte.</td></tr>'}</tbody></table>

<h2>Définitions et méthodologie</h2>
<ul>
<li><b>GMV</b> : volume des paiements commerçants + envois d'argent entre personnes, en FCFA. Les recharges et retraits sont comptés à part.</li>
<li><b>Utilisateur actif</b> : utilisateur inscrit (profil complet + code PIN) avec au moins un événement dans la période (connexion, ouverture de l'app, message, paiement, envoi, recharge, retrait).</li>
<li><b>Activation</b> : part des inscrits ayant réalisé au moins un paiement chez un commerçant.</li>
<li><b>Rétention J+n</b> : part d'une cohorte (inscrits le même jour) active exactement n jours après son inscription.</li>
<li><b>Jour</b> : journée civile du Cameroun (UTC+1). Tous les compteurs sont calculés à partir d'un journal d'événements immuable, dédoublonné.</li>
<li><b>Confidentialité</b> : le contenu des messages n'est ni stocké ni analysé ; seules des métadonnées (type, horodatage) sont comptées.</li>
<li><b>Périmètre temporel</b> : le suivi détaillé démarre à la mise en service du journal ; les chiffres antérieurs ne sont pas reconstitués.</li>
</ul>
<p class="muted">Document généré automatiquement — chiffres non audités.</p>
</div>
<script nonce="${nonce}">document.getElementById("print").addEventListener("click",function(){window.print()});</script>
</body></html>`;
}
