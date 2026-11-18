import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { periodReport } from "./adminMetrics.mjs";
import {
  fcfa,
  renderEmailHtml,
  renderEmailText,
  sendAdminEmail,
  sendAdminPush,
} from "./adminNotify.mjs";
import { totals } from "./adminStore.mjs";
import {
  dayKey,
  monthBounds,
  prevMonth,
  shiftDay,
  weekKey,
} from "./adminTime.mjs";
import { getDocClient, getTableName, ttlFromNowMs } from "./dynamodb.mjs";

const doc = getDocClient();

const KIND_LABEL = { daily: "du jour", weekly: "de la semaine", monthly: "du mois" };

function frDate(day) {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

function arrow(pct) {
  if (pct === null || pct === undefined) return "nouveau";
  if (pct === 0) return "= stable";
  return `${pct > 0 ? "▲ +" : "▼ "}${String(pct).replace(".", ",")} %`;
}

/** Période d'un récap selon la date d'exécution (jour local Cameroun). */
export function recapPeriods(todayLocal) {
  const yesterday = shiftDay(todayLocal, -1);
  const out = [{ kind: "daily", from: yesterday, to: yesterday, key: yesterday }];
  const dow = new Date(`${todayLocal}T00:00:00Z`).getUTCDay();
  if (dow === 1) {
    const to = yesterday;
    const from = shiftDay(to, -6);
    out.push({ kind: "weekly", from, to, key: from, activeKind: "week", activeKey: weekKey(Date.parse(`${from}T12:00:00Z`)) });
  }
  if (todayLocal.endsWith("-01")) {
    const month = prevMonth(todayLocal.slice(0, 7));
    const { from, to } = monthBounds(month);
    out.push({ kind: "monthly", from, to, key: month, activeKind: "month", activeKey: month });
  }
  return out;
}

export function buildRecap(kind, report, cumulative) {
  const c = report.current;
  const d = report.delta;
  const title =
    kind === "daily"
      ? `Récap du ${frDate(report.from)}`
      : kind === "weekly"
        ? `Récap de la semaine du ${frDate(report.from)} au ${frDate(report.to)}`
        : `Récap mensuel — ${report.from.slice(0, 7)}`;

  const activeLabel =
    report.uniqueActive != null
      ? ["Utilisateurs actifs (uniques)", String(report.uniqueActive)]
      : ["Utilisateurs actifs", String(report.series.at(-1)?.activeUsers ?? 0)];

  const lines = [
    ["Nouveaux inscrits", `${c.newUsers}  (${arrow(d.newUsers)})`],
    activeLabel,
    ["Actifs / jour (moyenne)", String(c.dauAvg)],
    ["Ouvertures de l'app", `${c.appOpens}  (${arrow(d.appOpens)})`],
    ["Connexions", String(c.logins)],
    ["Messages envoyés", `${c.messages}  (${arrow(d.messages)})`],
    ["Transactions", `${c.txCount}  (${arrow(d.txCount)})`],
    ["Volume échangé (GMV)", `${fcfa(c.gmvFcfa)}  (${arrow(d.gmvFcfa)})`],
    ["  dont paiements commerçants", `${c.payments} — ${fcfa(c.paymentVolumeFcfa)}`],
    ["  dont envois entre personnes", `${c.transfers} — ${fcfa(c.transferVolumeFcfa)}`],
    ["Ticket moyen", fcfa(c.avgTicketFcfa)],
    ["Recharges", `${c.deposits} — ${fcfa(c.depositVolumeFcfa)}  (${arrow(d.depositVolumeFcfa)})`],
    ["Retraits", `${c.withdrawals} — ${fcfa(c.withdrawalVolumeFcfa)}`],
    ["Ajustements admin (crédit / débit)", `${fcfa(c.adminCreditFcfa)} / ${fcfa(c.adminDebitFcfa)}`],
    ["Comptes supprimés", String(c.deletedUsers)],
    ["Total inscrits (cumul)", String(cumulative.users ?? 0)],
    ["Total commerçants ayant encaissé", String(cumulative.payingMerchants ?? 0)],
  ];

  if (report.top) {
    const fmt = (arr) =>
      arr.length
        ? arr.map((x) => `${x.label} (${x.count}× — ${fcfa(x.volumeFcfa)})`).join(" · ")
        : "—";
    lines.push(["Top commerçants", fmt(report.top.merchants)]);
    lines.push(["Top payeurs", fmt(report.top.payers)]);
    lines.push(["Top recharges", fmt(report.top.depositors)]);
  }

  const intro = `${title}. Comparé à la période précédente (${frDate(report.previous.from)} → ${frDate(report.previous.to)}).`;
  const mail = { heading: title, intro, lines, accent: "#5dc705", footer: "Récap automatique Blyp — fuseau Cameroun (UTC+1)." };
  const pushBody = `${c.newUsers} inscrits · ${c.txCount} tx · ${fcfa(c.gmvFcfa)} · ${c.deposits} recharges`;
  return {
    subject: `[Blyp] ${title}`,
    html: renderEmailHtml(mail),
    text: renderEmailText(mail),
    pushTitle: title,
    pushBody,
    kindLabel: KIND_LABEL[kind],
  };
}

async function claimRecap(kind, key) {
  try {
    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: {
          PK: `ARECAP#${kind}`,
          SK: key,
          sentAt: new Date().toISOString(),
          expiresAt: ttlFromNowMs(400 * 24 * 60 * 60 * 1000),
        },
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
    return true;
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}

/**
 * @param {{ now?: number, force?: boolean, only?: "daily"|"weekly"|"monthly", date?: string }} opts
 */
export async function runRecaps({ now = Date.now(), force = false, only = null, date = null } = {}) {
  const todayLocal = date || dayKey(now);
  const periods = recapPeriods(todayLocal).filter((p) => !only || p.kind === only);
  const results = [];
  const cumulative = await totals();
  for (const p of periods) {
    if (!force && !(await claimRecap(p.kind, p.key))) {
      results.push({ kind: p.kind, key: p.key, skipped: "ALREADY_SENT" });
      continue;
    }
    const report = await periodReport(p.from, p.to, {
      withTop: true,
      activeKind: p.activeKind ?? null,
      activeKey: p.activeKey ?? null,
    });
    const recap = buildRecap(p.kind, report, cumulative);
    const res = { kind: p.kind, key: p.key };
    try {
      res.email = await sendAdminEmail(recap);
    } catch (err) {
      res.email = { error: String(err?.message ?? err) };
      console.error("[adminRecap] email failed", res.email.error);
    }
    try {
      res.push = await sendAdminPush({
        title: recap.pushTitle,
        body: recap.pushBody,
        eventId: `recap-${p.kind}-${p.key}`,
        eventType: `recap_${p.kind}`,
      });
    } catch (err) {
      res.push = { error: String(err?.message ?? err) };
    }
    results.push(res);
  }
  return results;
}
