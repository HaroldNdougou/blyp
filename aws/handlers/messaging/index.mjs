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
  lookupPhonesOnBlyp,
  markConversationDelivered,
  markConversationRead,
  markConversationTyping,
  openDirectConversation,
  recallMoneyTransfer,
  sendMoneyMessage,
  sendTextMessage,
  sendVoiceMessage,
  sendImageMessage,
  setMessageReaction,
  deleteMessage,
  thankMoneyTransfer,
  assertMember,
} from "../../lib/messaging.mjs";
import {
  presignImagePlay,
  presignImageUpload,
  presignVoicePlay,
  presignVoiceUpload,
} from "../../lib/media.mjs";

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

    if (method === "POST" && path === "/contacts/blyp-lookup") {
      const body = parseJsonBody(event);
      if (body === null) return badRequest("JSON invalide");
      const phones = Array.isArray(body.phones) ? body.phones : [];
      if (phones.length === 0) {
        return badRequest("phones requis (tableau de numéros)");
      }
      const result = await lookupPhonesOnBlyp(phones);
      return ok(result);
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
        return ok({
          items: result.messages,
          peerLastReadAt: result.peerLastReadAt ?? null,
          peerLastDeliveredAt: result.peerLastDeliveredAt ?? null,
        });
      }
      if (method === "POST") {
        const body = parseJsonBody(event);
        if (body === null) return badRequest("JSON invalide");
        const type = String(body.type || "text").toLowerCase();
        if (type === "read") {
          const result = await markConversationRead(userId, conversationId);
          if (result.error === "FORBIDDEN") return forbidden("Accès refusé");
          return ok(result);
        }
        if (type === "delivered") {
          const result = await markConversationDelivered(userId, conversationId);
          if (result.error === "FORBIDDEN") return forbidden("Accès refusé");
          return ok(result);
        }
        if (type === "voice-presign") {
          const member = await assertMember(conversationId, userId);
          if (!member) return forbidden("Accès refusé");
          const result = await presignVoiceUpload(userId, conversationId);
          if (result.error === "MEDIA_UNAVAILABLE") {
            return serverError("Media indisponible");
          }
          return ok(result);
        }
        if (type === "voice-play") {
          const member = await assertMember(conversationId, userId);
          if (!member) return forbidden("Accès refusé");
          const result = await presignVoicePlay(conversationId, body.key);
          if (result.error === "MEDIA_UNAVAILABLE") {
            return serverError("Media indisponible");
          }
          if (result.error === "KEY_INVALID") {
            return badRequest("Fichier vocal invalide");
          }
          return ok(result);
        }
        if (type === "voice") {
          const result = await sendVoiceMessage(
            userId,
            conversationId,
            body.key,
            body.durationMs,
            body.clientId,
            body.replyToMessageId,
          );
          if (result.error === "FORBIDDEN") return forbidden("Accès refusé");
          if (result.error === "VOICE_INVALID") {
            return badRequest("Vocal invalide");
          }
          if (result.error === "REPLY_NOT_FOUND") {
            return notFound("Message cité introuvable");
          }
          return ok(result);
        }
        if (type === "image-presign") {
          const member = await assertMember(conversationId, userId);
          if (!member) return forbidden("Accès refusé");
          const result = await presignImageUpload(
            userId,
            conversationId,
            body.contentType,
          );
          if (result.error === "MEDIA_UNAVAILABLE") {
            return serverError("Media indisponible");
          }
          return ok(result);
        }
        if (type === "image-play") {
          const member = await assertMember(conversationId, userId);
          if (!member) return forbidden("Accès refusé");
          const result = await presignImagePlay(conversationId, body.key);
          if (result.error === "MEDIA_UNAVAILABLE") {
            return serverError("Media indisponible");
          }
          if (result.error === "KEY_INVALID") {
            return badRequest("Image invalide");
          }
          return ok(result);
        }
        if (type === "image") {
          const result = await sendImageMessage(
            userId,
            conversationId,
            body.key,
            body.width,
            body.height,
            body.clientId,
            body.caption ?? body.body,
            body.replyToMessageId,
          );
          if (result.error === "FORBIDDEN") return forbidden("Accès refusé");
          if (result.error === "IMAGE_INVALID") {
            return badRequest("Image invalide");
          }
          if (result.error === "REPLY_NOT_FOUND") {
            return notFound("Message cité introuvable");
          }
          if (result.error === "BODY_INVALID") {
            return badRequest("Légende invalide");
          }
          return ok(result);
        }
        if (type === "react") {
          const result = await setMessageReaction(
            userId,
            conversationId,
            body.messageId,
            body.emoji,
          );
          if (result.error === "FORBIDDEN") return forbidden("Accès refusé");
          if (result.error === "NOT_FOUND") {
            return notFound("Message introuvable");
          }
          if (result.error === "EMOJI_INVALID") {
            return badRequest("Réaction invalide");
          }
          return ok(result);
        }
        if (type === "delete") {
          const messageId = String(body.messageId ?? "").trim();
          if (!messageId) return badRequest("messageId requis");
          const scope = String(body.scope ?? "me").toLowerCase();
          const result = await deleteMessage(
            userId,
            conversationId,
            messageId,
            scope,
          );
          if (result.error === "FORBIDDEN") return forbidden("Accès refusé");
          if (result.error === "NOT_FOUND") {
            return notFound("Message introuvable");
          }
          if (result.error === "TOO_LATE") {
            return badRequest("Suppression pour tous impossible", {
              code: "DELETE_TOO_LATE",
            });
          }
          if (result.error === "SCOPE_INVALID") {
            return badRequest("scope invalide (me | everyone)");
          }
          if (result.error === "MONEY_RECALL_FAILED") {
            return badRequest("Impossible d’annuler le transfert");
          }
          return ok(result);
        }
        if (type === "typing") {
          const result = await markConversationTyping(
            userId,
            conversationId,
            body.on !== false && body.on !== 0 && body.on !== "0",
          );
          if (result.error === "FORBIDDEN") return forbidden("Accès refusé");
          return ok(result);
        }
        if (type === "money-thanks") {
          const transferId = String(body.transferId ?? "").trim();
          if (!transferId) return badRequest("Transfert requis");
          const result = await thankMoneyTransfer(userId, transferId);
          if (result.error === "NOT_FOUND") return notFound("Transfert introuvable");
          if (result.error === "FORBIDDEN" || result.error === "SELF") {
            return forbidden("Action impossible");
          }
          return ok(result);
        }
        if (type === "text") {
          const result = await sendTextMessage(
            userId,
            conversationId,
            body.body,
            body.clientId,
            body.replyToMessageId,
          );
          if (result.error === "FORBIDDEN") return forbidden("Accès refusé");
          if (result.error === "BODY_INVALID") {
            return badRequest("Message invalide");
          }
          if (result.error === "REPLY_NOT_FOUND") {
            return notFound("Message cité introuvable");
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
            return badRequest("Code PIN incorrect", {
              code: "TRANSACTION_PIN_INVALID",
            });
          }
          const amount = parseInt(String(body.amount), 10);
          const result = await sendMoneyMessage(
            userId,
            conversationId,
            amount,
            body.clientId,
            getIdempotencyKey(event) || body.idempotencyKey,
            body.replyToMessageId,
          );
          if (result.error === "FORBIDDEN") return forbidden("Accès refusé");
          if (result.error === "REPLY_NOT_FOUND") {
            return notFound("Message cité introuvable");
          }
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
      const body = parseJsonBody(event) ?? {};
      const action = String(body.action || "claim").toLowerCase();
      if (action !== "claim" && action !== "recall") {
        return badRequest("Action invalide");
      }
      const result =
        action === "recall"
          ? await recallMoneyTransfer(userId, transferId)
          : await claimMoneyTransfer(userId, transferId);
      if (result.error === "NOT_FOUND") return notFound("Transfert introuvable");
      if (result.error === "FORBIDDEN" || result.error === "SELF") {
        return forbidden("Vous ne pouvez pas effectuer cette action");
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
        return conflict("Action impossible pour le moment");
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
