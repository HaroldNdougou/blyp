import { TransactWriteCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDocClient, getTableName } from "./dynamodb.mjs";
import { getCommerceRecord, commercePk } from "./commerce.mjs";
import {
  verifyCommercePaymentReceiptSignature,
} from "./paymentReceipt.mjs";

const doc = getDocClient();

export const CODE_PAYMENT_RECEIPT_ALREADY_ENCASHED =
  "PAYMENT_RECEIPT_ALREADY_ENCASHED";

/** Signature valide ; expiration ignorée (encaissement après coup autorisé si signé). */
function receiptEncashable(receipt) {
  return verifyCommercePaymentReceiptSignature(receipt);
}

export async function encashCommercePaymentReceipt(
  ownerUserId,
  commerceId,
  receipt,
) {
  const cid = String(commerceId ?? "").trim();
  if (!cid || !receiptEncashable(receipt)) {
    return { ok: false, status: 400, message: "Reçu invalide" };
  }
  const rec = await getCommerceRecord(ownerUserId, cid);
  if (!rec) return { ok: false, status: 404, message: "Commerce introuvable" };

  const accountId = String(rec.accountId ?? "")
    .trim()
    .toUpperCase();
  if (
    String(receipt.recipientAccountId ?? "")
      .trim()
      .toUpperCase() !== accountId
  ) {
    return { ok: false, status: 403, message: "Reçu pour un autre compte" };
  }
  if (receipt.commerceId && String(receipt.commerceId) !== cid) {
    return { ok: false, status: 403, message: "Reçu pour un autre commerce" };
  }

  const txId = String(receipt.transactionId ?? "").trim();
  if (!txId) return { ok: false, status: 400, message: "transactionId manquant" };

  const globalKey = { PK: `RECEIPT_ENCASH#${txId}`, SK: "META" };
  const existing = await doc.send(
    new GetCommand({ TableName: getTableName(), Key: globalKey }),
  );
  if (existing.Item) {
    if (String(existing.Item.commerceId) === cid) {
      return { ok: true, first: false, transactionId: txId };
    }
    return {
      ok: false,
      status: 409,
      code: CODE_PAYMENT_RECEIPT_ALREADY_ENCASHED,
      message: "Reçu déjà encaissé (anti-rejeu)",
    };
  }

  const now = new Date().toISOString();
  try {
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: getTableName(),
              Item: {
                ...globalKey,
                transactionId: txId,
                commerceId: cid,
                amountFcfa: Math.floor(receipt.amountFcfa),
                encashedAt: now,
                encashedByUserId: ownerUserId,
              },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
          {
            Put: {
              TableName: getTableName(),
              Item: {
                PK: commercePk(cid),
                SK: `RECEIPT_ENCASH#${txId}`,
                transactionId: txId,
                encashedAt: now,
                amountFcfa: Math.floor(receipt.amountFcfa),
              },
            },
          },
        ],
      }),
    );
  } catch (err) {
    if (err?.name === "TransactionCanceledException") {
      const raced = await doc.send(
        new GetCommand({ TableName: getTableName(), Key: globalKey }),
      );
      if (raced.Item && String(raced.Item.commerceId) === cid) {
        return { ok: true, first: false, transactionId: txId };
      }
      if (raced.Item) {
        return {
          ok: false,
          status: 409,
          code: CODE_PAYMENT_RECEIPT_ALREADY_ENCASHED,
          message: "Reçu déjà encaissé (anti-rejeu)",
        };
      }
    }
    throw err;
  }

  return { ok: true, first: true, transactionId: txId };
}

export async function listCommerceEncashedReceipts(
  ownerUserId,
  commerceId,
  sinceIso,
) {
  const cid = String(commerceId ?? "").trim();
  const rec = await getCommerceRecord(ownerUserId, cid);
  if (!rec) return { ok: false, status: 404, message: "Commerce introuvable" };

  const res = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": commercePk(cid),
        ":sk": "RECEIPT_ENCASH#",
      },
      ScanIndexForward: false,
      Limit: 250,
    }),
  );

  const sinceMs = sinceIso ? Date.parse(String(sinceIso)) : 0;
  const items = (res.Items ?? [])
    .filter((it) => {
      if (!sinceMs || Number.isNaN(sinceMs)) return true;
      const t = Date.parse(String(it.encashedAt ?? ""));
      return Number.isFinite(t) && t >= sinceMs;
    })
    .map((it) => ({
      transactionId: String(it.transactionId ?? ""),
      encashedAt: String(it.encashedAt ?? ""),
      amountFcfa: Number(it.amountFcfa ?? 0),
    }))
    .filter((it) => it.transactionId);

  return { ok: true, items };
}
