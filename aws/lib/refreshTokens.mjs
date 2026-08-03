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

const doc = getDocClient();

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

async function putRefreshSession({ userId, familyId, tokenHash, expiresAt }) {
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

/** Après OTP vérifié : access court + refresh long. */
export async function issueAuthSession(userId) {
  const accessToken = await signAccessToken(userId);
  const refreshToken = newRefreshRaw();
  const tokenHash = hashRefreshToken(refreshToken);
  const familyId = randomUUID();
  const expiresAt = ttlFromNowMs(REFRESH_TTL_MS);
  await putRefreshSession({ userId, familyId, tokenHash, expiresAt });
  return { token: accessToken, refreshToken };
}

/**
 * Rotation : invalide l’ancien refresh, émet access + refresh neufs.
 * @returns {{ token: string, refreshToken: string } | null}
 */
export async function rotateAuthSession(refreshTokenRaw) {
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

  const accessToken = await signAccessToken(item.userId);
  const nextRaw = newRefreshRaw();
  const nextHash = hashRefreshToken(nextRaw);
  const expiresAt = ttlFromNowMs(REFRESH_TTL_MS);
  await putRefreshSession({
    userId: item.userId,
    familyId: item.familyId,
    tokenHash: nextHash,
    expiresAt,
  });

  return { token: accessToken, refreshToken: nextRaw };
}
