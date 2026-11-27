import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ADMIN_EVENT_TYPES } from "../../lib/adminEvents.mjs";
import { describeEvent, notifyAdminOfEvent } from "../../lib/adminNotify.mjs";
import {
  getSettings,
  ingestEvent,
  takeEmailSlot,
} from "../../lib/adminStore.mjs";
import { getDocClient, getTableName } from "../../lib/dynamodb.mjs";
import { getUserProfile } from "../../lib/user.mjs";

/**
 * Worker SQS : transforme chaque événement brut en :
 *   1. ligne de journal (idempotente) ;
 *   2. compteurs / statistiques investisseurs ;
 *   3. alerte push + email selon les préférences.
 *
 * SQS livre « au moins une fois » : `ingestEvent` déduplique par id d'événement,
 * et on ne notifie QUE si l'événement vient d'être enregistré pour la première fois.
 */

const doc = getDocClient();

/** Destinataire d'un message (métadonnées seulement), pour la fiche événement. */
async function enrichMessage(evt) {
  const conversationId = String(evt.data?.conversationId ?? "");
  if (!conversationId) return;
  const res = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `CONV#${conversationId}`,
        ":sk": "MEMBER#",
      },
    }),
  );
  const peer = (res.Items ?? []).find((m) => m.userId !== evt.userId);
  if (peer) {
    evt.data.toName = peer.displayName ?? null;
    evt.data.toPhone = peer.phone ?? null;
  }
}

function validate(evt) {
  return (
    evt &&
    typeof evt.id === "string" &&
    evt.id.length >= 8 &&
    ADMIN_EVENT_TYPES.includes(evt.type) &&
    Number.isFinite(Date.parse(evt.at))
  );
}

async function processOne(body, settings) {
  let evt;
  try {
    evt = JSON.parse(body);
  } catch {
    console.warn("[adminEvents] unparseable event dropped");
    return;
  }
  if (!validate(evt)) {
    console.warn("[adminEvents] invalid event dropped");
    return;
  }
  evt.data = evt.data && typeof evt.data === "object" ? evt.data : {};

  const profile = evt.userId ? await getUserProfile(evt.userId) : null;
  if (evt.type === "message") {
    await enrichMessage(evt).catch((err) =>
      console.warn("[adminEvents] enrich failed", err?.message ?? err),
    );
  }

  const { stored, item } = await ingestEvent(evt, profile);
  if (!stored || !item) return;

  const prefs = settings.notify[item.type];
  if (!prefs?.push && !prefs?.email) return;

  /** Push déjà envoyé en synchrone par `createMoneyRequest` (même id que la demande). */
  const moneyInstant =
    (item.type === "deposit" || item.type === "withdrawal") &&
    String(item.data?.requestId ?? "") === String(item.id ?? "");
  const notifyPrefs =
    moneyInstant && prefs?.push ? { ...prefs, push: false } : prefs;

  /** Les événements d'argent / actions admin passent TOUJOURS par email (pas de plafond). */
  const critical = describeEvent(item).severity !== "info";
  const emailAllowed =
    !prefs.email || critical ? true : await takeEmailSlot(settings.emailPerMinuteCap);
  await notifyAdminOfEvent(item, notifyPrefs, { emailAllowed });
}

/** @param {{ Records?: Array<{ messageId: string, body: string }> }} event */
export async function handler(event) {
  const settings = await getSettings();
  const failures = [];
  for (const record of event?.Records ?? []) {
    try {
      await processOne(record.body, settings);
    } catch (err) {
      console.error("[adminEvents] failed", record.messageId, err?.message ?? err);
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
}
