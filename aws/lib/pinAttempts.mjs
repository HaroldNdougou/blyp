/**
 * Essais de code secret hors paiement — fenêtre glissante, verrou temporaire anti-devinette.
 */
import { DeleteCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getDocClient, getTableName } from "./dynamodb.mjs";
import { userPk } from "./user.mjs";

const doc = getDocClient();
const SK = "PIN_ATTEMPTS";
export const PIN_MAX_WRONG = 5;
const WINDOW_SEC = 15 * 60;

/** @returns {Promise<number>} secondes restantes de verrou (0 = libre) */
export async function pinLockRemainingSec(userId) {
  const res = await doc.send(
    new GetCommand({ TableName: getTableName(), Key: { PK: userPk(userId), SK } }),
  );
  const it = res.Item;
  const nowSec = Math.floor(Date.now() / 1000);
  if (!it || !it.expiresAt || it.expiresAt <= nowSec) return 0;
  return (it.count ?? 0) >= PIN_MAX_WRONG ? it.expiresAt - nowSec : 0;
}

/** @returns {Promise<number>} essais restants avant verrou */
export async function recordWrongPin(userId) {
  const nowSec = Math.floor(Date.now() / 1000);
  const res = await doc.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK },
      UpdateExpression:
        "SET #c = if_not_exists(#c, :z) + :one, expiresAt = if_not_exists(expiresAt, :e)",
      ExpressionAttributeNames: { "#c": "count" },
      ExpressionAttributeValues: { ":z": 0, ":one": 1, ":e": nowSec + WINDOW_SEC },
      ReturnValues: "ALL_NEW",
    }),
  );
  const attrs = res.Attributes ?? {};
  if (attrs.expiresAt && attrs.expiresAt <= nowSec) {
    await clearPinAttempts(userId);
    return recordWrongPin(userId);
  }
  return Math.max(0, PIN_MAX_WRONG - (attrs.count ?? 0));
}

export async function clearPinAttempts(userId) {
  await doc.send(
    new DeleteCommand({ TableName: getTableName(), Key: { PK: userPk(userId), SK } }),
  );
}
