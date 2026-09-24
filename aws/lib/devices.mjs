import {
  DeleteCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { createHash } from "node:crypto";
import { getDocClient, getTableName } from "./dynamodb.mjs";
import { userPk } from "./user.mjs";

const doc = getDocClient();

const EXPO_TOKEN_RE = /^ExponentPushToken\[.+\]$/;

/**
 * @param {string} token
 */
export function isValidExpoPushToken(token) {
  return typeof token === "string" && EXPO_TOKEN_RE.test(token.trim());
}

/**
 * @param {string} token
 */
function deviceSkFromToken(token) {
  const hash = createHash("sha256").update(token.trim()).digest("hex").slice(0, 32);
  return `DEVICE#${hash}`;
}

/**
 * @param {{ token: string, deviceId?: string | null }} input
 */
function deviceSk(input) {
  const deviceId = String(input?.deviceId ?? "").trim();
  if (deviceId) return `DEVICE#${deviceId}`;
  return deviceSkFromToken(input.token);
}

/**
 * @param {string} userId
 * @param {{ token: string, platform?: string, deviceId?: string | null }} input
 */
export async function upsertDeviceToken(userId, input) {
  const token = String(input?.token ?? "").trim();
  if (!isValidExpoPushToken(token)) {
    return { error: "TOKEN_INVALID" };
  }
  const platform = String(input?.platform ?? "").trim().toLowerCase() || "unknown";
  const deviceId = String(input?.deviceId ?? "").trim() || null;
  const now = new Date().toISOString();
  const sk = deviceSk({ token, deviceId });

  /** 1 appareil = 1 entrée (deviceId) — évite 3 tokens fantômes. */
  if (deviceId) {
    const existing = await listDeviceTokens(userId);
    for (const d of existing) {
      if (d.deviceId === deviceId && d.SK !== sk) {
        await doc.send(
          new DeleteCommand({
            TableName: getTableName(),
            Key: { PK: userPk(userId), SK: d.SK },
          }),
        );
      }
    }
  }

  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: userPk(userId),
        SK: sk,
        token,
        platform,
        deviceId,
        updatedAt: now,
        createdAt: now,
      },
    }),
  );

  return { ok: true, sk };
}

/**
 * @param {string} userId
 * @param {string} token
 */
export async function deleteDeviceTokenByValue(userId, token) {
  const t = String(token ?? "").trim();
  if (!isValidExpoPushToken(t)) return { ok: true };
  const devices = await listDeviceTokens(userId);
  for (const d of devices) {
    if (d.token !== t || !d.SK) continue;
    await doc.send(
      new DeleteCommand({
        TableName: getTableName(),
        Key: { PK: userPk(userId), SK: d.SK },
      }),
    );
  }
  return { ok: true };
}

/**
 * @param {string} userId
 * @param {{ token?: string, deviceId?: string | null }} input
 */
export async function deleteDeviceToken(userId, input) {
  const token = String(input?.token ?? "").trim();
  if (token && isValidExpoPushToken(token)) {
    await doc.send(
      new DeleteCommand({
        TableName: getTableName(),
        Key: { PK: userPk(userId), SK: deviceSkFromToken(token) },
      }),
    );
    return { ok: true };
  }

  const deviceId = String(input?.deviceId ?? "").trim();
  if (!deviceId) return { error: "TOKEN_REQUIRED" };

  const devices = await listDeviceTokens(userId);
  const hit = devices.find((d) => d.deviceId === deviceId);
  if (!hit?.SK) return { ok: true };
  await doc.send(
    new DeleteCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK: hit.SK },
    }),
  );
  return { ok: true };
}

/**
 * @param {string} userId
 * @returns {Promise<Array<{ token: string, platform?: string, deviceId?: string | null, SK: string }>>}
 */
export async function listDeviceTokens(userId) {
  const res = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": userPk(userId),
        ":sk": "DEVICE#",
      },
    }),
  );
  return (res.Items ?? [])
    .filter((it) => typeof it.token === "string" && isValidExpoPushToken(it.token))
    .map((it) => ({
      token: String(it.token),
      platform: it.platform ? String(it.platform) : undefined,
      deviceId: it.deviceId != null ? String(it.deviceId) : null,
      SK: String(it.SK),
    }));
}

