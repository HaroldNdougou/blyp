import { verifyAccessToken } from "../../lib/jwt.mjs";
import {
  markConversationPresence,
  markConversationTyping,
} from "../../lib/messaging.mjs";
import {
  postPayloadToConnection,
  registerWsConnection,
  unregisterWsConnection,
} from "../../lib/realtimeWs.mjs";

function wsResponse(statusCode, body) {
  return { statusCode, body: body ?? "" };
}

export async function handler(event) {
  const route = event?.requestContext?.routeKey ?? "";
  const connectionId = event?.requestContext?.connectionId ?? "";

  try {
    if (route === "$connect") {
      const token = String(event?.queryStringParameters?.token ?? "").trim();
      if (!token) return wsResponse(401, "Unauthorized");
      const userId = await verifyAccessToken(token);
      await registerWsConnection(userId, connectionId);
      return wsResponse(200, "Connected");
    }

    if (route === "$disconnect") {
      await unregisterWsConnection(connectionId);
      return wsResponse(200);
    }

    if (route === "$default") {
      const { GetCommand } = await import("@aws-sdk/lib-dynamodb");
      const { getDocClient, getTableName } = await import(
        "../../lib/dynamodb.mjs"
      );
      const doc = getDocClient();
      const got = await doc.send(
        new GetCommand({
          TableName: getTableName(),
          Key: { PK: `WS_CONN#${connectionId}`, SK: "META" },
        }),
      );
      const userId = String(got.Item?.userId ?? "").trim();
      if (!userId) return wsResponse(401);

      let body = {};
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return wsResponse(400, "Invalid JSON");
      }

      const action = String(body.action ?? "").toLowerCase();
      const conversationId = String(body.conversationId ?? "").trim();

      if (action === "ping") {
        await postPayloadToConnection(connectionId, { type: "pong" });
        return wsResponse(200);
      }

      if (action === "presence" && conversationId) {
        const result = await markConversationPresence(userId, conversationId);
        if (result.error === "FORBIDDEN") return wsResponse(403);
        return wsResponse(200);
      }

      if (action === "typing" && conversationId) {
        const on =
          body.on !== false && body.on !== 0 && body.on !== "0";
        const result = await markConversationTyping(
          userId,
          conversationId,
          on,
        );
        if (result.error === "FORBIDDEN") return wsResponse(403);
        return wsResponse(200);
      }

      return wsResponse(400, "Unknown action");
    }

    return wsResponse(404);
  } catch (err) {
    if (String(err?.message ?? "").includes("INVALID")) {
      return wsResponse(401, "Unauthorized");
    }
    console.error("[realtime]", err);
    return wsResponse(500);
  }
}
