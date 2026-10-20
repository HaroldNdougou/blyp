import { randomUUID } from "node:crypto";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { getDocClient, getTableName } from "./dynamodb.mjs";
import { getUserApiPayload, userPk } from "./user.mjs";
import {
  extFromFileName,
  sanitizeDocumentFileName,
} from "./media.mjs";

const doc = getDocClient();

const PUT_TTL_SEC = 300;
const GET_TTL_SEC = 600;

export const VAULT_MAX_ACCOUNT_BYTES = 200 * 1024 * 1024;
export const VAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;

function mediaBucket() {
  return String(process.env.MEDIA_BUCKET ?? "").trim();
}

function vaultSk(accountId, docId) {
  return `VAULT#${accountId}#${docId}`;
}

function vaultKeyPrefix(accountId) {
  const id = String(accountId ?? "").trim();
  if (!id || id.includes("..") || id.includes("/")) return null;
  return `vault/${id}/`;
}

export function isOwnedVaultKey(key, accountId) {
  const k = String(key ?? "").trim();
  const prefix = vaultKeyPrefix(accountId);
  if (!prefix || !k || k.includes("..")) return false;
  return k.startsWith(prefix) && /\.[a-zA-Z0-9]{1,8}$/.test(k);
}

async function s3Signer() {
  const [
    { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand },
    { getSignedUrl },
  ] = await Promise.all([
    import("@aws-sdk/client-s3"),
    import("@aws-sdk/s3-request-presigner"),
  ]);
  const region = String(
    process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "af-south-1",
  ).trim();
  const client = new S3Client({
    region,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return { client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, getSignedUrl };
}

export async function resolveVaultAccountId(userId) {
  const api = await getUserApiPayload(userId);
  const accountId = String(api?.id ?? "").trim();
  if (!accountId) return { error: "ACCOUNT_INVALID" };
  return { accountId };
}

async function sumVaultBytes(userId, accountId) {
  const prefix = `VAULT#${accountId}#`;
  let used = 0;
  let lastKey;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": userPk(userId),
          ":sk": prefix,
        },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of res.Items ?? []) {
      used += Math.floor(Number(item.sizeBytes) || 0);
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return used;
}

function itemToDoc(item) {
  if (!item?.docId) return null;
  return {
    id: String(item.docId),
    accountId: String(item.accountId ?? ""),
    name: String(item.name ?? "Document"),
    sizeBytes: Math.floor(Number(item.sizeBytes) || 0),
    contentType: String(item.contentType ?? "application/octet-stream"),
    createdAt: String(item.createdAt ?? ""),
  };
}

export async function listVaultDocuments(userId) {
  const scope = await resolveVaultAccountId(userId);
  if (scope.error) return scope;
  const { accountId } = scope;
  const prefix = `VAULT#${accountId}#`;
  const items = [];
  let lastKey;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": userPk(userId),
          ":sk": prefix,
        },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const row of res.Items ?? []) {
      const d = itemToDoc(row);
      if (d) items.push(d);
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const usedBytes = items.reduce((a, d) => a + d.sizeBytes, 0);
  return {
    items,
    usedBytes,
    maxBytes: VAULT_MAX_ACCOUNT_BYTES,
    accountId,
  };
}

export async function presignVaultUpload(userId, body) {
  const scope = await resolveVaultAccountId(userId);
  if (scope.error) return scope;
  const { accountId } = scope;
  const sizeBytes = Math.floor(Number(body?.sizeBytes) || 0);
  if (sizeBytes <= 0 || sizeBytes > VAULT_MAX_FILE_BYTES) {
    return { error: "SIZE_INVALID" };
  }
  const used = await sumVaultBytes(userId, accountId);
  if (used + sizeBytes > VAULT_MAX_ACCOUNT_BYTES) {
    return { error: "QUOTA_EXCEEDED" };
  }
  const b = mediaBucket();
  if (!b) return { error: "VAULT_UNAVAILABLE" };
  const fileName = sanitizeDocumentFileName(body?.fileName);
  const fromName = extFromFileName(fileName);
  const ct =
    String(body?.contentType ?? "").trim() || fromName.contentType;
  const ext = fromName.ext;
  const docId = randomUUID();
  const keyPrefix = vaultKeyPrefix(accountId);
  if (!keyPrefix) return { error: "ACCOUNT_INVALID" };
  const objectKey = `${keyPrefix}${docId}.${ext}`;
  const { client, PutObjectCommand, getSignedUrl } = await s3Signer();
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: b,
      Key: objectKey,
      ContentType: ct,
    }),
    { expiresIn: PUT_TTL_SEC },
  );
  return {
    docId,
    uploadUrl,
    key: objectKey,
    contentType: ct,
    expiresIn: PUT_TTL_SEC,
  };
}

export async function confirmVaultDocument(userId, body) {
  const scope = await resolveVaultAccountId(userId);
  if (scope.error) return scope;
  const { accountId } = scope;
  const docId = String(body?.docId ?? "").trim();
  const key = String(body?.key ?? "").trim();
  const name = sanitizeDocumentFileName(body?.name);
  const sizeBytes = Math.floor(Number(body?.sizeBytes) || 0);
  const contentType =
    String(body?.contentType ?? "").trim() || "application/octet-stream";
  if (!docId || !key || name.length < 1) return { error: "INVALID_INPUT" };
  if (!isOwnedVaultKey(key, accountId)) return { error: "KEY_INVALID" };
  if (sizeBytes <= 0 || sizeBytes > VAULT_MAX_FILE_BYTES) {
    return { error: "SIZE_INVALID" };
  }
  const used = await sumVaultBytes(userId, accountId);
  if (used + sizeBytes > VAULT_MAX_ACCOUNT_BYTES) {
    return { error: "QUOTA_EXCEEDED" };
  }
  const now = new Date().toISOString();
  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: userPk(userId),
        SK: vaultSk(accountId, docId),
        docId,
        accountId,
        name: name.length > 120 ? `${name.slice(0, 117)}…` : name,
        objectKey: key,
        sizeBytes,
        contentType,
        createdAt: now,
      },
    }),
  );
  const document = itemToDoc({
    docId,
    accountId,
    name,
    sizeBytes,
    contentType,
    createdAt: now,
  });
  return { document };
}

export async function presignVaultDownload(userId, docId) {
  const scope = await resolveVaultAccountId(userId);
  if (scope.error) return scope;
  const { accountId } = scope;
  const id = String(docId ?? "").trim();
  if (!id) return { error: "NOT_FOUND" };
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK: vaultSk(accountId, id) },
    }),
  );
  const row = res.Item;
  if (!row?.objectKey) return { error: "NOT_FOUND" };
  const b = mediaBucket();
  if (!b) return { error: "VAULT_UNAVAILABLE" };
  const { client, GetObjectCommand, getSignedUrl } = await s3Signer();
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: b, Key: String(row.objectKey) }),
    { expiresIn: GET_TTL_SEC },
  );
  return {
    url,
    expiresIn: GET_TTL_SEC,
    name: String(row.name ?? "document"),
    contentType: String(row.contentType ?? "application/octet-stream"),
  };
}

export async function deleteVaultDocument(userId, docId) {
  const scope = await resolveVaultAccountId(userId);
  if (scope.error) return scope;
  const { accountId } = scope;
  const id = String(docId ?? "").trim();
  if (!id) return { error: "NOT_FOUND" };
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK: vaultSk(accountId, id) },
    }),
  );
  const row = res.Item;
  if (!row) return { error: "NOT_FOUND" };
  await doc.send(
    new DeleteCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK: vaultSk(accountId, id) },
    }),
  );
  const b = mediaBucket();
  const key = String(row.objectKey ?? "").trim();
  if (b && key) {
    try {
      const { client, DeleteObjectCommand } = await s3Signer();
      await client.send(
        new DeleteObjectCommand({ Bucket: b, Key: key }),
      );
    } catch {
      /* métadonnée supprimée */
    }
  }
  return { ok: true };
}
