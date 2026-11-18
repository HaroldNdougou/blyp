/**
 * Jetons push de l'app admin (distincte de l'app client Blyp).
 * PK ADMIN#DEVICES / SK DEVICE#… — jamais liés à un compte utilisateur.
 */
import {
  DeleteCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { createHash } from "node:crypto";
import { getDocClient, getTableName } from "./dynamodb.mjs";
import { isValidExpoPushToken } from "./devices.mjs";

const doc = getDocClient();
const PK = "ADMIN#DEVICES";

function skFromToken(token) {
  const hash = createHash("sha256").update(token.trim()).digest("hex").slice(0, 32);
  return `DEVICE#${hash}`;
}

export async function upsertAdminDevice({ token, platform, deviceId, adminEmail }) {
  const t = String(token ?? "").trim();
  if (!isValidExpoPushToken(t)) return { error: "TOKEN_INVALID" };
  const now = new Date().toISOString();
  const sk = skFromToken(t);
  const id = String(deviceId ?? "").trim() || null;

  if (id) {
    const existing = await listAdminDevices();
    for (const d of existing) {
      if ((d.deviceId === id || d.token === t) && d.SK !== sk) {
        await doc.send(new DeleteCommand({ TableName: getTableName(), Key: { PK, SK: d.SK } }));
      }
    }
  }

  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK,
        SK: sk,
        token: t,
        platform: String(platform ?? "unknown").trim().toLowerCase() || "unknown",
        deviceId: id,
        adminEmail: String(adminEmail ?? "").trim().toLowerCase() || null,
        updatedAt: now,
        createdAt: now,
      },
    }),
  );
  return { ok: true };
}

export async function deleteAdminDeviceByToken(token) {
  const t = String(token ?? "").trim();
  if (!isValidExpoPushToken(t)) return { ok: true };
  await doc.send(
    new DeleteCommand({ TableName: getTableName(), Key: { PK, SK: skFromToken(t) } }),
  );
  return { ok: true };
}

export async function listAdminDevices() {
  const res = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": PK, ":sk": "DEVICE#" },
    }),
  );
  return (res.Items ?? []).filter((d) => d.token);
}
