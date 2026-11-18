import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  cohorts,
  dailyStats,
  eventsForRange,
  periodActiveUsers,
  sumDays,
  totals,
} from "./adminStore.mjs";
import {
  dayKey,
  daysBetween,
  monthBounds,
  monthKey,
  prevMonth,
  shiftDay,
  weekKey,
} from "./adminTime.mjs";
import { getDocClient, getTableName } from "./dynamodb.mjs";

/**
 * Indicateurs « niveau investisseur » calculés à partir des compteurs pré-agrégés
 * (aucun scan à la demande, sauf `computeFloat` qui est explicitement ponctuel).
 *
 * Définitions (à communiquer telles quelles en due diligence) :
 *  - GMV           = volume des paiements commerçants + envois entre personnes (FCFA) ;
 *  - Utilisateur actif = utilisateur inscrit ayant eu au moins un événement dans la période
 *                        (connexion, ouverture, message, paiement, envoi, recharge) ;
 *  - Activation    = utilisateurs ayant effectué au moins un paiement commerçant / inscrits ;
 *  - Rétention Dn  = part d'une cohorte d'inscription encore active n jours après l'inscription ;
 *  - Jour          = journée civile au Cameroun (UTC+1).
 */

const doc = getDocClient();

const n = (v) => Number(v) || 0;
const ratio = (a, b) => (b > 0 ? a / b : null);

export function derive(sum, days) {
  const gmv = n(sum.v_payment) + n(sum.v_transfer);
  const txCount = n(sum.n_payment) + n(sum.n_transfer);
  return {
    newUsers: n(sum.n_signup),
    logins: n(sum.n_login),
    appOpens: n(sum.n_app_open),
    messages: n(sum.n_message),
    payments: n(sum.n_payment),
    transfers: n(sum.n_transfer),
    txCount,
    gmvFcfa: gmv,
    paymentVolumeFcfa: n(sum.v_payment),
    transferVolumeFcfa: n(sum.v_transfer),
    avgTicketFcfa: txCount ? Math.round(gmv / txCount) : 0,
    deposits: n(sum.n_deposit),
    depositVolumeFcfa: n(sum.v_deposit),
    withdrawals: n(sum.n_withdrawal),
    withdrawalVolumeFcfa: n(sum.v_withdrawal),
    adminCreditFcfa: n(sum.v_admin_credit),
    adminDebitFcfa: n(sum.v_admin_debit),
    deletedUsers: n(sum.n_user_deleted),
    activatedUsers: n(sum.activatedUsers),
    activeMerchantDays: n(sum.activeMerchants),
    dauAvg: days > 0 ? Math.round((n(sum.activeUsers) / days) * 10) / 10 : 0,
  };
}

export function pctChange(current, previous) {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Rapport complet d'une période [from..to] + comparaison à la période précédente. */
export async function periodReport(from, to, { withTop = true, activeKind = null, activeKey = null } = {}) {
  const days = daysBetween(from, to) + 1;
  const prevTo = shiftDay(from, -1);
  const prevFrom = shiftDay(from, -days);
  const [rows, prevRows] = await Promise.all([
    dailyStats(from, to),
    dailyStats(prevFrom, prevTo),
  ]);
  const current = derive(sumDays(rows), days);
  const previous = derive(sumDays(prevRows), days);
  let uniqueActive = null;
  if (activeKind && activeKey) {
    uniqueActive = await periodActiveUsers(activeKind, activeKey);
  }
  const top = withTop ? await topFromEvents(from, to) : null;
  const delta = {};
  for (const key of Object.keys(current)) {
    delta[key] = pctChange(current[key], previous[key]);
  }
  return {
    from,
    to,
    days,
    previous: { from: prevFrom, to: prevTo },
    current,
    previousValues: previous,
    delta,
    uniqueActive,
    series: rows.map((r) => ({
      day: r.day,
      ...derive(r, 1),
      activeUsers: n(r.activeUsers),
      activeMerchants: n(r.activeMerchants),
    })),
    top,
  };
}

/** Top commerçants / payeurs / recharges sur la période (borné à 20 000 événements). */
export async function topFromEvents(from, to) {
  const events = await eventsForRange(from, to, {
    types: ["payment", "transfer", "deposit"],
    hardLimit: 20_000,
  });
  const merchants = new Map();
  const payers = new Map();
  const depositors = new Map();
  const bump = (map, key, label, amount) => {
    if (!key) return;
    const cur = map.get(key) ?? { label, count: 0, volumeFcfa: 0 };
    cur.count += 1;
    cur.volumeFcfa += n(amount);
    map.set(key, cur);
  };
  for (const e of events) {
    const amount = e.data?.amountFcfa;
    if (e.type === "payment") {
      bump(
        merchants,
        e.data?.commerceId ?? e.data?.payeeAccountId,
        e.data?.commerceName ?? e.data?.payeeName ?? "—",
        amount,
      );
    }
    if (e.type === "payment" || e.type === "transfer") {
      bump(payers, e.userId, e.name ?? e.phone ?? "—", amount);
    }
    if (e.type === "deposit") {
      bump(depositors, e.userId, e.name ?? e.phone ?? "—", amount);
    }
  }
  const take = (map) =>
    [...map.values()].sort((a, b) => b.volumeFcfa - a.volumeFcfa).slice(0, 5);
  return {
    merchants: take(merchants),
    payers: take(payers),
    depositors: take(depositors),
    scannedEvents: events.length,
  };
}

/**
 * Float total = somme de tous les soldes (utilisateurs + commerces). Scan ponctuel.
 * Sert de contrôle de réconciliation : float ≈ recharges + crédits admin − retraits − débits admin.
 */
export async function computeFloat() {
  let key;
  let userBalances = 0;
  let commerceBalances = 0;
  let holders = 0;
  let pages = 0;
  do {
    const res = await doc.send(
      new ScanCommand({
        TableName: getTableName(),
        FilterExpression:
          "SK = :b AND (begins_with(PK, :u) OR begins_with(PK, :c))",
        ExpressionAttributeValues: { ":b": "BALANCE", ":u": "USER#", ":c": "COMMERCE#" },
        ProjectionExpression: "PK, balanceFcfa",
        ...(key ? { ExclusiveStartKey: key } : {}),
      }),
    );
    for (const it of res.Items ?? []) {
      const v = n(it.balanceFcfa);
      if (String(it.PK).startsWith("COMMERCE#")) commerceBalances += v;
      else userBalances += v;
      if (v > 0) holders += 1;
    }
    key = res.LastEvaluatedKey;
    pages += 1;
  } while (key && pages < 200);
  return {
    userBalancesFcfa: userBalances,
    commerceBalancesFcfa: commerceBalances,
    totalFloatFcfa: userBalances + commerceBalances,
    holders,
    complete: !key,
  };
}

/** Réconciliation : valeur attendue du float d'après le journal. */
export function expectedFloat(totalsRow) {
  return (
    n(totalsRow.v_deposit) +
    n(totalsRow.v_admin_credit) -
    n(totalsRow.v_withdrawal) -
    n(totalsRow.v_admin_debit)
  );
}

/** Tableau de bord d'accueil : tout ce qu'il faut en un appel. */
export async function overview(now = Date.now()) {
  const today = dayKey(now);
  const [t, today7, month, wau, mau] = await Promise.all([
    totals(),
    dailyStats(shiftDay(today, -29), today),
    dailyStats(`${monthKey(now)}-01`, today),
    periodActiveUsers("week", weekKey(now)),
    periodActiveUsers("month", monthKey(now)),
  ]);
  const todayRow = today7[today7.length - 1] ?? {};
  const yesterdayRow = today7[today7.length - 2] ?? {};
  const last7 = sumDays(today7.slice(-7));
  const last30 = sumDays(today7);
  return {
    generatedAt: new Date(now).toISOString(),
    today,
    totals: {
      users: n(t.users),
      deletedUsers: n(t.deletedUsers),
      activatedUsers: n(t.activatedUsers),
      payingMerchants: n(t.payingMerchants),
      gmvFcfa: n(t.v_payment) + n(t.v_transfer),
      txCount: n(t.n_payment) + n(t.n_transfer),
      depositVolumeFcfa: n(t.v_deposit),
      withdrawalVolumeFcfa: n(t.v_withdrawal),
      messages: n(t.n_message),
      expectedFloatFcfa: expectedFloat(t),
    },
    today: { ...derive(todayRow, 1), activeUsers: n(todayRow.activeUsers), day: today },
    yesterday: { ...derive(yesterdayRow, 1), activeUsers: n(yesterdayRow.activeUsers) },
    month: { ...derive(sumDays(month), month.length), key: monthKey(now) },
    last7: derive(last7, 7),
    last30: derive(last30, 30),
    actives: {
      dau: n(todayRow.activeUsers),
      wau,
      mau,
      stickiness: ratio(n(todayRow.activeUsers), mau),
    },
    activationRate: ratio(n(t.activatedUsers), n(t.users)),
    series: today7.map((r) => ({
      day: r.day,
      newUsers: n(r.n_signup),
      activeUsers: n(r.activeUsers),
      gmvFcfa: n(r.v_payment) + n(r.v_transfer),
      txCount: n(r.n_payment) + n(r.n_transfer),
      depositVolumeFcfa: n(r.v_deposit),
      messages: n(r.n_message),
      appOpens: n(r.n_app_open),
    })),
  };
}

/** Série mensuelle (jusqu'à `months` mois) pour le pack investisseur. */
export async function monthlySeries(months = 12, now = Date.now()) {
  const out = [];
  let m = monthKey(now);
  const keys = [];
  for (let i = 0; i < months; i++) {
    keys.unshift(m);
    m = prevMonth(m);
  }
  const today = dayKey(now);
  for (const key of keys) {
    const { from, to } = monthBounds(key);
    const clampedTo = to > today ? today : to;
    if (from > today) continue;
    const rows = await dailyStats(from, clampedTo);
    const d = derive(sumDays(rows), rows.length);
    const mau = await periodActiveUsers("month", key);
    out.push({ month: key, mau, ...d });
  }
  return out;
}

export async function cohortTable(days = 60, now = Date.now()) {
  const today = dayKey(now);
  return cohorts(shiftDay(today, -(days - 1)), today);
}

/* -------------------------------------------------------------------------- */
/* Export CSV                                                                  */
/* -------------------------------------------------------------------------- */

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  /** Protection injection de formule (Excel / Sheets). */
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v !== "number" ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows, columns) {
  const cols = columns ?? (rows.length ? Object.keys(rows[0]) : []);
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(","));
  /** BOM UTF-8 : Excel affiche correctement les accents. */
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function eventsToCsvRows(events) {
  return events.map((e) => ({
    id: e.id,
    date_utc: e.at,
    type: e.type,
    user_id: e.userId,
    nom: e.name,
    telephone: e.phone,
    montant_fcfa: e.data?.amountFcfa ?? "",
    contrepartie: e.data?.commerceName ?? e.data?.payeeName ?? e.data?.toName ?? "",
    reference: e.data?.reference ?? e.data?.transactionId ?? "",
    details: e.data,
  }));
}
