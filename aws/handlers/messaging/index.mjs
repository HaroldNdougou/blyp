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
  markConversationPresence,
  openDirectConversation,
  recallMoneyTransfer,
  setMoneyTransferReceiptRequired,
  sendMoneyMessage,
  sendTextMessage,
  sendVoiceMessage,
  sendImageMessage,
  sendDocumentMessage,
  forwardMessages,
  setMessageReaction,
  deleteMessage,
  thankMoneyTransfer,
  assertMember,
} from "../../lib/messaging.mjs";
import {
  presignImagePlay,
  presignImageUpload,
  presignDocumentDownload,
  presignDocumentThumbDownload,
  presignDocumentThumbUpload,
  presignDocumentUpload,
  presignVoicePlay,
  presignVoiceUpload,
  presignStatusUpload,
} from "../../lib/media.mjs";
import {
  deleteMyStatuses,
  listStatusFeed,
  publishStatus,
  recordStatusView,
} from "../../lib/status.mjs";
import { translateTextBatch } from "../../lib/translate.mjs";

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

    const translateMatch = path.match(/^\/conversations\/([^/]+)\/translate$/);
    if (translateMatch && method === "POST") {
      const conversationId = decodeURIComponent(translateMatch[1]);
      const member = await assertMember(conversationId, userId);
      if (!member) return forbidden("Accès refusé");
      const body = parseJsonBody(event);
      if (body === null) return badRequest("JSON invalide");
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) return badRequest("items requis");
      if (items.length > 32) {
        return badRequest("Trop de messages à traduire");
      }
      const targetLanguage = String(body.targetLanguage ?? "en");
      const result = await translateTextBatch(items, targetLanguage);
      return ok(result);
    }

    const messagesMatch = path.match(/^\/conversations\/([^/]+)\/messages$/);
    if (messagesMatch) {
      const conversationId = decodeURIComponent(messagesMatch[1]);
      if (method === "GET") {
        const qs = event.queryStringParameters ?? {};
        const result = await listMessages(userId, conversationId, {
          limit: qs.limit,
          before: qs.before,
        });
        if (result.error === "FORBIDDEN") return forbidden("Accès refusé");
        return ok({
          items: result.messages,
          hasMore: Boolean(result.hasMore),
          oldestId: result.oldestId ?? null,
          peerLastReadAt: result.peerLastReadAt ?? null,
          peerLastDeliveredAt: result.peerLastDeliveredAt ?? null,
          peerLastPresenceAt: result.peerLastPresenceAt ?? null,
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
            {
              thumbKey: body.thumbKey,
              blurhash: body.blurhash,
            },
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
        if (type === "document-presign") {
          const member = await assertMember(conversationId, userId);
          if (!member) return forbidden("Accès refusé");
          const result = await presignDocumentUpload(
            userId,
            conversationId,
            body.contentType,
            body.fileName,
          );
          if (result.error === "MEDIA_UNAVAILABLE") {
            return serverError("Media indisponible");
          }
          return ok(result);
        }
        if (type === "document-download") {
          const member = await assertMember(conversationId, userId);
          if (!member) return forbidden("Accès refusé");
          const result = await presignDocumentDownload(
            conversationId,
            body.key,
          );
          if (result.error === "MEDIA_UNAVAILABLE") {
            return serverError("Media indisponible");
          }
          if (result.error === "KEY_INVALID") {
            return badRequest("Document invalide");
          }
          return ok(result);
        }
        if (type === "document-thumb-presign") {
          const member = await assertMember(conversationId, userId);
          if (!member) return forbidden("Accès refusé");
          const result = await presignDocumentThumbUpload(userId, conversationId);
          if (result.error === "MEDIA_UNAVAILABLE") {
            return serverError("Media indisponible");
          }
          return ok(result);
        }
        if (type === "document-thumb-download") {
          const member = await assertMember(conversationId, userId);
          if (!member) return forbidden("Accès refusé");
          const result = await presignDocumentThumbDownload(
            conversationId,
            body.key,
          );
          if (result.error === "MEDIA_UNAVAILABLE") {
            return serverError("Media indisponible");
          }
          if (result.error === "KEY_INVALID") {
            return badRequest("Vignette invalide");
          }
          return ok(result);
        }
        if (type === "document") {
          const result = await sendDocumentMessage(
            userId,
            conversationId,
            body.key,
            body.fileName,
            body.sizeBytes,
            body.contentType,
            body.clientId,
            body.replyToMessageId,
            body.thumbKey,
            body.pageCount,
            body.caption,
          );
          if (result.error === "FORBIDDEN") return forbidden("Accès refusé");
          if (result.error === "DOCUMENT_INVALID") {
            return badRequest("Document invalide");
          }
          if (result.error === "BODY_INVALID") {
            return badRequest("Légende invalide");
          }
          if (result.error === "REPLY_NOT_FOUND") {
            return notFound("Message cité introuvable");
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
        if (type === "presence") {
          const result = await markConversationPresence(userId, conversationId);
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
            body.forwarded === true || body.forwarded === 1 || body.forwarded === "1"
              ? { forwarded: true }
              : {},
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
        if (type === "forward") {
          const sourceConversationId = String(
            body.sourceConversationId ?? "",
          ).trim();
          const messageIds = Array.isArray(body.messageIds)
            ? body.messageIds
            : [];
          const clientIds =
            body.clientIds && typeof body.clientIds === "object"
              ? body.clientIds
              : {};
          const result = await forwardMessages(
            userId,
            conversationId,
            sourceConversationId,
            messageIds,
            clientIds,
          );
          if (result.error === "FORBIDDEN") return forbidden("Accès refusé");
          if (result.error === "IDS_INVALID") {
            return badRequest("Messages à transférer invalides");
          }
          if (result.error === "NOTHING_TO_FORWARD") {
            return badRequest("Aucun message à transférer", {
              code: "NOTHING_TO_FORWARD",
            });
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
            body.caption,
            body.moneyFruitEmoji,
            Boolean(body.receiptRequired),
          );
          if (result.error === "FORBIDDEN") return forbidden("Accès refusé");
          if (result.error === "REPLY_NOT_FOUND") {
            return notFound("Message cité introuvable");
          }
          if (result.error === "BODY_INVALID") {
            return badRequest("Légende invalide");
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

    const receiptReqMatch = path.match(
      /^\/money-transfers\/([^/]+)\/receipt-required$/,
    );
    if (method === "PATCH" && receiptReqMatch) {
      const transferId = decodeURIComponent(receiptReqMatch[1]);
      const body = parseJsonBody(event) ?? {};
      const required = body.required === true || body.required === "true";
      const result = await setMoneyTransferReceiptRequired(
        userId,
        transferId,
        required,
      );
      if (result.error === "NOT_FOUND") return notFound("Transfert introuvable");
      if (result.error === "FORBIDDEN") return forbidden("Accès refusé");
      if (result.error === "NOT_PENDING") {
        return conflict("Ce transfert n’est plus disponible", {
          transfer: result.transfer,
        });
      }
      if (result.error === "CONFLICT") {
        return conflict("Action impossible pour le moment", {
          transfer: result.transfer,
        });
      }
      return ok(result);
    }

    if (method === "GET" && path === "/status/feed") {
      return ok(await listStatusFeed(userId));
    }

    if (method === "POST" && path === "/status/upload-presign") {
      const body = parseJsonBody(event) ?? {};
      const result = await presignStatusUpload(userId, body.contentType);
      if (result.error === "MEDIA_UNAVAILABLE") {
        return serverError("Media indisponible");
      }
      return ok(result);
    }

    if (method === "POST" && path === "/status/posts") {
      const body = parseJsonBody(event) ?? {};
      const result = await publishStatus(userId, body);
      if (result.error === "MEDIA_INVALID") {
        return badRequest("Image requise");
      }
      if (result.error === "TEXT_REQUIRED") {
        return badRequest("Texte requis");
      }
      return ok(result);
    }

    const statusViewMatch = path.match(
      /^\/status\/posts\/([^/]+)\/view$/,
    );
    if (method === "POST" && statusViewMatch) {
      const postId = decodeURIComponent(statusViewMatch[1]);
      const result = await recordStatusView(userId, postId);
      if (result.error === "NOT_FOUND") return notFound("Statut introuvable");
      if (result.error === "ID_REQUIRED") return badRequest("id requis");
      return ok(result);
    }

    if (method === "DELETE" && path === "/status/me") {
      return ok(await deleteMyStatuses(userId));
    }

    return notFound(`Route messaging inconnue: ${method} ${path}`);
  } catch (err) {
    console.error("[messaging]", err);
    return serverError("Erreur messaging", {
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
