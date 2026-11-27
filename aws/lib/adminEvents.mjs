import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { randomUUID } from "node:crypto";

/**
 * Journal d'événements Blyp pour le tableau de bord admin.
 *
 * Règles :
 *  - ne JAMAIS faire échouer ou ralentir un parcours utilisateur (best-effort, timeout court) ;
 *  - jamais de contenu de message, de PIN, d'OTP ni de secret dans un événement ;
 *  - l'`id` est généré ici : le worker déduplique (SQS = au moins une fois).
 */

const sqs = new SQSClient({});
const SEND_TIMEOUT_MS = 1500;

/** Types connus (le worker rejette le reste). */
export const ADMIN_EVENT_TYPES = Object.freeze([
  "signup",
  "login",
  "app_open",
  "message",
  "payment",
  "transfer",
  "deposit",
  "withdrawal",
  "user_deleted",
  "admin_action",
]);

/** Événements qui comptent comme « utilisateur actif ». */
export const ACTIVITY_EVENT_TYPES = Object.freeze(
  new Set([
    "signup",
    "login",
    "app_open",
    "message",
    "payment",
    "transfer",
    "deposit",
    "withdrawal",
  ]),
);

/**
 * @param {{
 *   type: string,
 *   userId?: string | null,
 *   data?: Record<string, unknown>,
 *   at?: string,
 * }} evt
 */
export async function emitAdminEvent(evt) {
  try {
    const queueUrl = process.env.ADMIN_EVENTS_QUEUE_URL?.trim();
    if (!queueUrl) return { skipped: true, reason: "NO_QUEUE" };
    const type = String(evt?.type ?? "").trim();
    if (!ADMIN_EVENT_TYPES.includes(type)) {
      return { skipped: true, reason: "UNKNOWN_TYPE" };
    }
    const extId = String(evt?.id ?? "").trim();
    const body = {
      id: extId.length >= 8 ? extId : randomUUID(),
      type,
      at: evt?.at || new Date().toISOString(),
      userId: evt?.userId ? String(evt.userId) : null,
      data: evt?.data && typeof evt.data === "object" ? evt.data : {},
    };
    await Promise.race([
      sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(body),
        }),
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("admin event timeout")), SEND_TIMEOUT_MS),
      ),
    ]);
    return { ok: true, id: body.id };
  } catch (err) {
    console.warn("[adminEvents] emit failed", err?.message ?? err);
    return { skipped: true, reason: "ERROR" };
  }
}
