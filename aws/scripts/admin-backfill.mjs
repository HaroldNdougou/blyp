#!/usr/bin/env node
/**
 * Reconstitue l'historique AVANT la mise en service du journal admin :
 * inscriptions (profils complets) + recharges, paiements, envois (lignes d'historique des clients).
 *
 *   TABLE_NAME=blyp-dev AWS_REGION=af-south-1 node aws/scripts/admin-backfill.mjs [--dry-run]
 *
 * - Idempotent : identifiants d'événements déterministes (`bf-…`), rejouable sans doublon.
 * - Silencieux : écrit directement dans le journal, AUCUNE notification n'est envoyée.
 * - Non reconstituables (jamais enregistrés avant) : ouvertures d'app, connexions, messages.
 */
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ingestEvent } from "../lib/adminStore.mjs";
import { getDocClient, getTableName } from "../lib/dynamodb.mjs";

const dryRun = process.argv.includes("--dry-run");
const doc = getDocClient();

async function* scan(params) {
  let key;
  do {
    const res = await doc.send(
      new ScanCommand({ TableName: getTableName(), ...params, ...(key ? { ExclusiveStartKey: key } : {}) }),
    );
    for (const it of res.Items ?? []) yield it;
    key = res.LastEvaluatedKey;
  } while (key);
}

const profiles = new Map();
const stats = { signups: 0, deposits: 0, payments: 0, transfers: 0, skipped: 0 };

async function feed(evt, profile) {
  if (dryRun) return;
  await ingestEvent(evt, profile);
}

console.log(dryRun ? "Simulation (rien n'est écrit)…" : "Reconstitution en cours…");

/* Phase 1 — inscriptions */
for await (const p of scan({
  FilterExpression: "SK = :p AND begins_with(PK, :u)",
  ExpressionAttributeValues: { ":p": "PROFILE", ":u": "USER#" },
})) {
  profiles.set(p.userId, p);
  const complete = String(p.firstName ?? "").trim() && p.transactionPinHash;
  if (!complete || !p.createdAt) {
    stats.skipped += 1;
    continue;
  }
  await feed(
    {
      id: `bf-signup-${p.userId}`,
      type: "signup",
      at: p.createdAt,
      userId: p.userId,
      data: { phone: p.phone ?? null, completedBy: "backfill" },
    },
    p,
  );
  stats.signups += 1;
}

/* Phase 2 — mouvements d'argent (côté émetteur uniquement : pas de double comptage) */
for await (const tx of scan({
  FilterExpression: "begins_with(SK, :tx) AND begins_with(PK, :u)",
  ExpressionAttributeValues: { ":tx": "TX#", ":u": "USER#" },
})) {
  const profile = profiles.get(tx.userId);
  if (!profile || !tx.createdAt || !tx.transactionId) continue;
  const amountFcfa = Math.floor(Number(tx.amountFcfa) || 0);
  if (amountFcfa <= 0) continue;
  const base = { id: `bf-${tx.transactionId}`, at: tx.createdAt, userId: tx.userId };
  if (tx.type === "DEPOSIT") {
    await feed({ ...base, type: "deposit", data: { amountFcfa, transactionId: tx.transactionId, reference: tx.reference ?? null, provider: "backfill" } }, profile);
    stats.deposits += 1;
  } else if (tx.type === "PAYMENT") {
    const isCommerce = String(tx.counterpartyAccountId ?? "").toUpperCase().startsWith("BLYP-C-");
    await feed(
      {
        ...base,
        type: isCommerce ? "payment" : "transfer",
        data: {
          amountFcfa,
          transactionId: tx.transactionId,
          reference: tx.reference ?? null,
          payeeName: tx.counterpartyName ?? null,
          payeeAccountId: tx.counterpartyAccountId ?? null,
          commerceId: isCommerce ? tx.counterpartyAccountId : null,
          commerceName: isCommerce ? tx.counterpartyName ?? null : null,
        },
      },
      profile,
    );
    stats[isCommerce ? "payments" : "transfers"] += 1;
  } else if (tx.type === "MONEY_SEND") {
    await feed(
      {
        ...base,
        type: "transfer",
        data: { amountFcfa, transactionId: tx.transactionId, via: "chat", payeeName: tx.counterpartyName ?? null },
      },
      profile,
    );
    stats.transfers += 1;
  }
}

console.log(
  `${dryRun ? "À reconstituer" : "Reconstitué"} : ${stats.signups} inscriptions, ${stats.deposits} recharges, ${stats.payments} paiements commerçants, ${stats.transfers} envois (${stats.skipped} profils incomplets ignorés).`,
);
