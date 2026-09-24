import {
  badRequest,
  conflict,
  forbidden,
  getIdempotencyKey,
  normalizeApiPath,
  notFound,
  ok,
  parseJsonBody,
  serverError,
  unauthorized,
} from "../../lib/http.mjs";
import { verifyAccessToken } from "../../lib/jwt.mjs";
import {
  getTransactionPinPepper,
  verifyTransactionPin,
} from "../../lib/pin.mjs";
import { getUserProfile } from "../../lib/user.mjs";
import {
  claimMoneyTransfer,
  listConversations,
  listMessages,
  openDirectConversation,
  sendMoneyMessage,
  sendTextMessage,
} from "../../lib/messaging.mjs";

async function requireUserId(event) {
  const token = event.headers?.authorization ?? event.headers?.Authorization;
  if (!token?.startsWith("Bearer ")) return { error: unauthorized() };
  try {
    const userId = await verifyAccessToken(token.slice(7).trim());
    return { userId };
  } catch {
    return { error: unauthorized("Session invalide") };
  }
}

function pathParams(event) {
  return event.pathParameters ?? {};
}

export async function handler(event) {
  try {
    const method = (
      event.requestContext?.http?.method ??
      event.httpMethod ??
      "GET"
    ).toUpperCase();
    const path = normalizeApiPath(event);

    const auth = await requireUserId(event);
    if (auth.error) return auth.error;
    const { userId } = auth;

    if (method === "GET" && path === "/conversations") {
      const items = await listConversations(userId);
      return ok({ items });
    }

    if (method === "POST" && path === "/conversations") {
      const body = parseJsonBody(event);
      if (body === null) return badRequest("JSON invalide");
      const result = await openDirectConversation(userId, body.phone);
      if (result.error === "PHONE_INVALID") {
        return badRequest("Numéro invalide (9 chiffres Cameroun)");
      }
      if (result.error === "SELF") {
        return badRequest("Vous ne pouvez pas vous écrire à vous-même");
      }
      if (result.error === "USER_NOT_FOUND") {
        return notFound("Utilisateur introuvable");
      }
      return ok(result);
    }

    const messagesMatch = path.match(/^\/conversations\/([^/]+)\/messages$/);
    if (messagesMatch) {
      const conversationId = decodeURIComponent(messagesMatch[1]);
      if (method === "GET") {
        const result = await listMessages(userId, conversationId);
        if (result.error === "FORBIDDEN") return forbidden("Accès refusé");
        return ok({ items: result.messages });
      }
      if (method === "POST") {
        const body = parseJsonBody(event);
        if (body === null) return badRequest("JSON invalide");
        const type = String(body.type || "text").toLowerCase();
        if (type === "text") {
          const result = await sendTextMessage(
            userId,
            conversationId,
            body.body,
            body.clientId,
          );
          if (result.error === "FORBIDDEN") return forbidden("Accès refusé");
          if (result.error === "BODY_INVALID") {
            return badRequest("Message invalide");
          }
          return ok(result);
        }
        if (type === "money") {
          const transactionPin = String(body.transactionPin ?? "").replace(
            /\D/g,
            "",
          );
          if (transactionPin.length !== 4) {
            return badRequest("Code PIN de transaction requis (4 chiffres)");
          }
          const profile = await getUserProfile(userId);
          if (!profile) return notFound("Utilisateur introuvable");
          if (!profile.transactionPinHash) {
            return forbidden("Complétez votre inscription (code PIN) pour payer");
          }
          if (
            !verifyTransactionPin(
              transactionPin,
              profile.transactionPinHash,
              getTransactionPinPepper(),
            )
          ) {
            return badRequest("Code PIN incorrect");
          }
          const amount = parseInt(String(body.amount), 10);
          const result = await sendMoneyMessage(
            userId,
            conversationId,
            amount,
            body.clientId,
            getIdempotencyKey(event) || body.idempotencyKey,
          );
          if (result.error === "FORBIDDEN") return forbidden("Accès refusé");
          if (result.error === "AMOUNT_INVALID") {
            return badRequest("Montant invalide");
          }
          if (result.error === "INSUFFICIENT_BALANCE") {
            return conflict("Solde insuffisant");
          }
          if (result.error === "PEER_MISSING") {
            return badRequest("Destinataire introuvable");
          }
          return ok(result);
        }
        return badRequest("Type de message invalide");
      }
    }

    const claimMatch = path.match(/^\/money-transfers\/([^/]+)\/claim$/);
    if (method === "POST" && claimMatch) {
      const transferId = decodeURIComponent(claimMatch[1]);
      const result = await claimMoneyTransfer(userId, transferId);
      if (result.error === "NOT_FOUND") return notFound("Transfert introuvable");
      if (result.error === "FORBIDDEN" || result.error === "SELF") {
        return forbidden("Vous ne pouvez pas retirer ce transfert");
      }
      if (result.error === "EXPIRED") {
        return conflict("Ce transfert a expiré et a été remboursé");
      }
      if (result.error === "NOT_PENDING") {
        return conflict("Ce transfert n’est plus disponible", {
          transfer: result.transfer,
        });
      }
      if (result.error === "CONFLICT") {
        return conflict("Retrait impossible pour le moment");
      }
      return ok(result);
    }

    return notFound(`Route messaging inconnue: ${method} ${path}`);
  } catch (err) {
    console.error("[messaging]", err);
    return serverError("Erreur messaging", {
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
