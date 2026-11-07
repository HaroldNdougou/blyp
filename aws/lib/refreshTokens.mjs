/**
 * Refresh tokens longue durée (style WhatsApp) — stockés hashés dans DynamoDB.
 * Rotation à chaque /auth/refresh ; réutilisation d’un ancien jeton ⇒ révocation famille.
 */
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDocClient, getTableName, ttlFromNowMs } from "./dynamodb.mjs";
import { signAccessToken } from "./jwt.mjs";
import { userPk } from "./user.mjs";
import { listDeviceTokens } from "./devices.mjs";
import { checkRefreshProof, deviceKeyRequired, parseDevicePublicKey } from "./deviceKey.mjs";

const doc = getDocClient();

const AUTH_SESSION_SK = "AUTH_SESSION";

/** 180 jours — session persistante jusqu’à désinstall / logout / vol de jeton. */
export const REFRESH_TTL_MS = 180 * 24 * 60 * 60 * 1000;

function hashRefreshToken(raw) {
  return createHash("sha256").update(String(raw), "utf8").digest("hex");
}

function refreshPk(tokenHash) {
  return `REFRESH#${tokenHash}`;
}

function familyPk(familyId) {
  return `RFAMILY#${familyId}`;
}

function newRefreshRaw() {
  return randomBytes(32).toString("base64url");
}

async function putRefreshSession({ userId, familyId, tokenHash, expiresAt, devicePublicKey = null }) {
  const now = new Date().toISOString();
  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: refreshPk(tokenHash),
        SK: "META",
        userId,
        familyId,
        tokenHash,
        createdAt: now,
        expiresAt,
        ...(devicePublicKey ? { devicePublicKey } : {}),
        entityType: "REFRESH",
      },
    }),
  );
  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: familyPk(familyId),
        SK: `TOKEN#${tokenHash}`,
        userId,
        tokenHash,
        expiresAt,
        entityType: "REFRESH_FAMILY",
      },
    }),
  );
}

async function deleteRefreshSession(tokenHash, familyId) {
  await doc.send(
    new DeleteCommand({
      TableName: getTableName(),
      Key: { PK: refreshPk(tokenHash), SK: "META" },
    }),
  );
  if (familyId) {
    await doc.send(
      new DeleteCommand({
        TableName: getTableName(),
        Key: { PK: familyPk(familyId), SK: `TOKEN#${tokenHash}` },
      }),
    );
  }
}

async function revokeFamily(familyId) {
  const table = getTableName();
  const res = await doc.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": familyPk(familyId),
        ":sk": "TOKEN#",
      },
    }),
  );
  const items = res.Items ?? [];
  for (const it of items) {
    const h = it.tokenHash;
    if (!h) continue;
    await doc.send(
      new DeleteCommand({
        TableName: table,
        Key: { PK: refreshPk(h), SK: "META" },
      }),
    );
    await doc.send(
      new DeleteCommand({
        TableName: table,
        Key: { PK: familyPk(familyId), SK: `TOKEN#${h}` },
      }),
    );
  }
}

async function getAuthSessionItem(userId) {
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK: AUTH_SESSION_SK },
    }),
  );
  return res.Item ?? null;
}

export async function getActiveSessionFamilyId(userId) {
  const item = await getAuthSessionItem(userId);
  const fid = String(item?.activeFamilyId ?? "").trim();
  return fid || null;
}

async function setActiveSessionFamily(userId, familyId) {
  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: userPk(userId),
        SK: AUTH_SESSION_SK,
        activeFamilyId: familyId,
        updatedAt: new Date().toISOString(),
      },
    }),
  );
}

async function revokePreviousUserSession(userId) {
  const item = await getAuthSessionItem(userId);
  const prev = String(item?.activeFamilyId ?? "").trim();
  if (prev) await revokeFamily(prev);
}

async function purgePushTokensForUser(userId) {
  const devices = await listDeviceTokens(userId);
  for (const d of devices) {
    if (!d.SK) continue;
    await doc.send(
      new DeleteCommand({
        TableName: getTableName(),
        Key: { PK: userPk(userId), SK: d.SK },
      }),
    );
  }
}

/** Après OTP vérifié : access court + refresh long, liés à la clé appareil si fournie. */
export async function issueAuthSession(userId, devicePublicKeyRaw = null) {
  const devicePublicKey = parseDevicePublicKey(devicePublicKeyRaw)
    ? String(devicePublicKeyRaw).trim()
    : null;
  await revokePreviousUserSession(userId);
  await purgePushTokensForUser(userId);

  const refreshToken = newRefreshRaw();
  const tokenHash = hashRefreshToken(refreshToken);
  const familyId = randomUUID();
  const expiresAt = ttlFromNowMs(REFRESH_TTL_MS);
  await putRefreshSession({ userId, familyId, tokenHash, expiresAt, devicePublicKey });
  await setActiveSessionFamily(userId, familyId);
  const accessToken = await signAccessToken(userId, familyId, devicePublicKey);
  return { token: accessToken, refreshToken };
}

/**
 * Rotation : invalide l’ancien refresh, émet access + refresh neufs.
 * Session liée à une clé appareil ⇒ preuve signée obligatoire (refresh volé inutile ailleurs).
 * Session historique sans clé ⇒ adopte la clé fournie si sa preuve est valide (migration silencieuse).
 * @returns {{ token: string, refreshToken: string } | { replaced: true } | { badProof: true } | { clockSkew: true } | null}
 */
export async function rotateAuthSession(refreshTokenRaw, deviceProof = null) {
  const raw = String(refreshTokenRaw ?? "").trim();
  if (!raw || raw.length < 20) return null;

  const tokenHash = hashRefreshToken(raw);
  const table = getTableName();
  const res = await doc.send(
    new GetCommand({
      TableName: table,
      Key: { PK: refreshPk(tokenHash), SK: "META" },
    }),
  );
  const item = res.Item;
  if (!item?.userId || !item.familyId) {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (item.revokedAt) {
    await revokeFamily(item.familyId);
    return null;
  }
  if (item.expiresAt && item.expiresAt <= nowSec) {
    await deleteRefreshSession(tokenHash, item.familyId);
    return null;
  }

  const activeFamilyId = await getActiveSessionFamilyId(item.userId);
  if (activeFamilyId && item.familyId !== activeFamilyId) {
    return { replaced: true };
  }

  let devicePublicKey = String(item.devicePublicKey ?? "").trim() || null;
  if (devicePublicKey) {
    const st = checkRefreshProof(devicePublicKey, raw, deviceProof);
    if (st === "skew") return { clockSkew: true };
    if (st !== "ok") return { badProof: true };
  } else {
    if (deviceKeyRequired()) return { badProof: true };
    const offered = String(deviceProof?.publicKey ?? "").trim();
    if (offered && parseDevicePublicKey(offered)) {
      const st = checkRefreshProof(offered, raw, deviceProof);
      if (st === "skew") return { clockSkew: true };
      if (st === "ok") devicePublicKey = offered;
    }
  }

  /** Marque révoqué avant rotation — réutilisation concurrente ⇒ famille tuée. */
  try {
    await doc.send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: refreshPk(tokenHash), SK: "META" },
        UpdateExpression: "SET revokedAt = :r",
        ConditionExpression: "attribute_not_exists(revokedAt)",
        ExpressionAttributeValues: { ":r": new Date().toISOString() },
      }),
    );
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") {
      await revokeFamily(item.familyId);
      return null;
    }
    throw err;
  }

  await deleteRefreshSession(tokenHash, item.familyId);

  const nextRaw = newRefreshRaw();
  const nextHash = hashRefreshToken(nextRaw);
  const expiresAt = ttlFromNowMs(REFRESH_TTL_MS);
  await putRefreshSession({
    userId: item.userId,
    familyId: item.familyId,
    tokenHash: nextHash,
    expiresAt,
    devicePublicKey,
  });

  const accessToken = await signAccessToken(item.userId, item.familyId, devicePublicKey);
  return { token: accessToken, refreshToken: nextRaw };
}
