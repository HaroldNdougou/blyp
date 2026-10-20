import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { getDocClient, getTableName } from "./dynamodb.mjs";

const doc = getDocClient();

function connMetaPk(connectionId) {
  return `WS_CONN#${connectionId}`;
}

function userConnPk(userId) {
  return `WS#${userId}`;
}

function userConnSk(connectionId) {
  return `CONN#${connectionId}`;
}

function getMgmtClient() {
  const endpoint = process.env.REALTIME_WS_API_ENDPOINT?.trim();
  if (!endpoint) return null;
  return new ApiGatewayManagementApiClient({ endpoint });
}

export async function registerWsConnection(userId, connectionId) {
  const uid = String(userId ?? "").trim();
  const cid = String(connectionId ?? "").trim();
  if (!uid || !cid) return;
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 86_400;
  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: connMetaPk(cid),
        SK: "META",
        userId: uid,
        connectionId: cid,
        connectedAt: now,
        ttl,
      },
    }),
  );
  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: userConnPk(uid),
        SK: userConnSk(cid),
        connectionId: cid,
        connectedAt: now,
        ttl,
      },
    }),
  );
}

export async function unregisterWsConnection(connectionId) {
  const cid = String(connectionId ?? "").trim();
  if (!cid) return null;
  const meta = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: connMetaPk(cid), SK: "META" },
    }),
  );
  const userId = String(meta.Item?.userId ?? "").trim();
  await doc.send(
    new DeleteCommand({
      TableName: getTableName(),
      Key: { PK: connMetaPk(cid), SK: "META" },
    }),
  );
  if (userId) {
    await doc.send(
      new DeleteCommand({
        TableName: getTableName(),
        Key: { PK: userConnPk(userId), SK: userConnSk(cid) },
      }),
    );
  }
  return userId || null;
}

async function listConnectionsForUser(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return [];
  const res = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": userConnPk(uid),
        ":sk": "CONN#",
      },
    }),
  );
  return res.Items ?? [];
}

export async function postPayloadToConnection(connectionId, payload) {
  const client = getMgmtClient();
  if (!client) return { ok: false, reason: "NO_ENDPOINT" };
  try {
    await client.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(payload)),
      }),
    );
    return { ok: true };
  } catch (err) {
    const code = err?.$metadata?.httpStatusCode ?? err?.statusCode;
    if (code === 410) return { ok: false, gone: true };
    throw err;
  }
}

/** Envoie un événement temps réel à toutes les sockets d’un utilisateur. */
export async function postRealtimeToUser(userId, payload) {
  const items = await listConnectionsForUser(userId);
  if (!items.length) return 0;
  let sent = 0;
  for (const row of items) {
    const connectionId = String(row.connectionId ?? "").trim();
    if (!connectionId) continue;
    const res = await postPayloadToConnection(connectionId, payload);
    if (res.ok) sent += 1;
    if (res.gone) {
      await unregisterWsConnection(connectionId);
    }
  }
  return sent;
}
