import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { accountPk, makeCommerceAccountId } from "./accountId.mjs";
import { getDocClient, getTableName } from "./dynamodb.mjs";
import { getUserBalance, getUserProfile, userPk } from "./user.mjs";

const doc = getDocClient();

const CATEGORIES = new Set(["taxi", "shop", "other"]);

function commerceMetaSk(commerceId) {
  return `COMMERCE#${commerceId}`;
}

function commercePk(commerceId) {
  return `COMMERCE#${commerceId}`;
}

function trimName(s) {
  return String(s ?? "").trim().replace(/\s+/g, " ").slice(0, 48);
}

function normalizeCategory(raw) {
  const c = String(raw ?? "other").trim().toLowerCase();
  return CATEGORIES.has(c) ? c : "other";
}

function normalizePhoneDigits(phone, fallbackPhone) {
  const d = String(phone ?? fallbackPhone ?? "").replace(/\D/g, "");
  const last9 = d.length >= 9 ? d.slice(-9) : d;
  if (!/^6\d{8}$/.test(last9)) return null;
  return last9;
}

export function commerceToApi(item, balanceFcfa = 0) {
  return {
    id: item.commerceId,
    accountId: item.accountId,
    name: item.name,
    category: item.category ?? "other",
    phoneDigits: item.phoneDigits ?? null,
    balanceFcfa,
    createdAt: item.createdAt ?? null,
  };
}

export async function getAccountMeta(accountId) {
  const id = String(accountId ?? "").trim().toUpperCase();
  if (!id.startsWith("BLYP-")) return null;
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: accountPk(id), SK: "META" },
    }),
  );
  return res.Item ?? null;
}

/**
 * Lookup public ultra-light : 1 GetItem ACCOUNT#… (+ évent. profil perso).
 * Pour libellé BLE client (Taxi Mohamed) sans scan table.
 */
export async function getPublicAccountLabel(accountId) {
  const meta = await getAccountMeta(accountId);
  if (!meta) return null;
  const id = String(meta.accountId ?? accountId)
    .trim()
    .toUpperCase();
  if (meta.kind === "commerce") {
    const name = String(meta.name ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 48);
    if (name.length < 2) return null;
    return {
      accountId: id,
      displayName: name,
      kind: "commerce",
    };
  }
  const userId = meta.userId != null ? String(meta.userId) : "";
  if (!userId) {
    return {
      accountId: id,
      displayName: null,
      kind: "personal",
    };
  }
  const profile = await getUserProfile(userId);
  const first = String(profile?.firstName ?? "")
    .trim()
    .slice(0, 32);
  const displayName = first.length >= 2 ? first : null;
  return {
    accountId: id,
    displayName,
    kind: "personal",
  };
}

/** Résout un accountId public → wallet perso ou commerce. */
export async function resolvePayTarget(accountId) {
  const meta = await getAccountMeta(accountId);
  if (!meta?.userId) return null;
  if (meta.kind === "commerce" && meta.commerceId) {
    return {
      type: "commerce",
      ownerUserId: String(meta.userId),
      commerceId: String(meta.commerceId),
      accountId: String(meta.accountId ?? accountId),
      name: meta.name ? String(meta.name) : null,
    };
  }
  return {
    type: "personal",
    userId: String(meta.userId),
    accountId: String(meta.accountId ?? accountId),
  };
}

export async function getCommerceBalance(commerceId) {
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: commercePk(commerceId), SK: "BALANCE" },
    }),
  );
  return Number(res.Item?.balanceFcfa ?? 0);
}

export async function getCommerceRecord(ownerUserId, commerceId) {
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: userPk(ownerUserId), SK: commerceMetaSk(commerceId) },
    }),
  );
  return res.Item ?? null;
}

export async function listCommercesForUser(userId) {
  const res = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": userPk(userId),
        ":sk": "COMMERCE#",
      },
    }),
  );
  const items = res.Items ?? [];
  const withBalances = await Promise.all(
    items.map(async (it) => {
      const balanceFcfa = await getCommerceBalance(it.commerceId);
      return commerceToApi(it, balanceFcfa);
    }),
  );
  withBalances.sort((a, b) =>
    String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")),
  );
  return withBalances;
}

export async function createCommerce(userId, input) {
  const profile = await getUserProfile(userId);
  if (!profile) return { error: "USER_NOT_FOUND" };
  if (!profile.transactionPinHash) return { error: "ONBOARDING_REQUIRED" };

  const name = trimName(input?.name);
  if (name.length < 2) return { error: "NAME_INVALID" };

  const category = normalizeCategory(input?.category);
  const phoneDigits = normalizePhoneDigits(input?.phone, profile.phone);
  if (!phoneDigits) return { error: "PHONE_INVALID" };

  const existing = await listCommercesForUser(userId);
  if (existing.length >= 10) return { error: "LIMIT" };

  for (let attempt = 0; attempt < 5; attempt++) {
    const commerceId = randomUUID();
    const accountId = makeCommerceAccountId();
    const now = new Date().toISOString();
    try {
      await doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: getTableName(),
                Item: {
                  PK: userPk(userId),
                  SK: commerceMetaSk(commerceId),
                  commerceId,
                  accountId,
                  name,
                  category,
                  phoneDigits,
                  ownerUserId: userId,
                  createdAt: now,
                  updatedAt: now,
                },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Put: {
                TableName: getTableName(),
                Item: {
                  PK: commercePk(commerceId),
                  SK: "BALANCE",
                  commerceId,
                  balanceFcfa: 0,
                  updatedAt: now,
                },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Put: {
                TableName: getTableName(),
                Item: {
                  PK: accountPk(accountId),
                  SK: "META",
                  kind: "commerce",
                  userId,
                  commerceId,
                  accountId,
                  name,
                  createdAt: now,
                },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Update: {
                TableName: getTableName(),
                Key: { PK: userPk(userId), SK: "PROFILE" },
                UpdateExpression:
                  "SET activeContextType = :t, activeCommerceId = :cid, isMerchant = :m, updatedAt = :now",
                ConditionExpression: "attribute_exists(PK)",
                ExpressionAttributeValues: {
                  ":t": "commerce",
                  ":cid": commerceId,
                  ":m": true,
                  ":now": now,
                },
              },
            },
          ],
        }),
      );
      return {
        commerce: commerceToApi(
          {
            commerceId,
            accountId,
            name,
            category,
            phoneDigits,
            createdAt: now,
          },
          0,
        ),
      };
    } catch (err) {
      if (err?.name !== "TransactionCanceledException") throw err;
    }
  }
  return { error: "CREATE_FAILED" };
}

export async function setActiveContext(userId, input) {
  const type = String(input?.type ?? "personal").toLowerCase();
  const now = new Date().toISOString();

  if (type === "personal") {
    await doc.send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: { PK: userPk(userId), SK: "PROFILE" },
        UpdateExpression:
          "SET activeContextType = :t, activeCommerceId = :null, updatedAt = :now",
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeValues: {
          ":t": "personal",
          ":null": null,
          ":now": now,
        },
      }),
    );
    return { ok: true };
  }

  if (type !== "commerce") return { error: "TYPE_INVALID" };
  const commerceId = String(input?.commerceId ?? "").trim();
  if (!commerceId) return { error: "COMMERCE_REQUIRED" };
  const rec = await getCommerceRecord(userId, commerceId);
  if (!rec) return { error: "NOT_FOUND" };

  await doc.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK: "PROFILE" },
      UpdateExpression:
        "SET activeContextType = :t, activeCommerceId = :cid, isMerchant = :m, updatedAt = :now",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeValues: {
        ":t": "commerce",
        ":cid": commerceId,
        ":m": true,
        ":now": now,
      },
    }),
  );
  return { ok: true, commerceId };
}

/**
 * Solde + identité publique selon le contexte actif.
 * @returns {{ balanceFcfa: number, publicId: string, activeContext: object, displayFirstName: string|null, displayLastName: string|null, commerces: object[] }}
 */
export async function resolveActiveWallet(userId, profile) {
  const commerces = await listCommercesForUser(userId);
  const ctxType =
    profile?.activeContextType === "commerce" ? "commerce" : "personal";
  let activeCommerceId =
    ctxType === "commerce" && profile?.activeCommerceId
      ? String(profile.activeCommerceId)
      : null;

  let active = commerces.find((c) => c.id === activeCommerceId) ?? null;
  if (ctxType === "commerce" && !active) {
    activeCommerceId = null;
  }

  if (active) {
    const personalBalance = await getUserBalance(userId);
    return {
      balanceFcfa: active.balanceFcfa,
      publicId: active.accountId,
      displayFirstName: active.name,
      displayLastName: null,
      personalAccountId: null,
      personalBalanceFcfa: personalBalance,
      activeContext: {
        type: "commerce",
        commerceId: active.id,
        name: active.name,
        accountId: active.accountId,
        category: active.category,
      },
      commerces,
    };
  }

  const personalBalance = await getUserBalance(userId);
  return {
    balanceFcfa: personalBalance,
    publicId: null,
    displayFirstName: profile?.firstName ?? null,
    displayLastName: profile?.lastName ?? null,
    personalAccountId: null,
    personalBalanceFcfa: personalBalance,
    activeContext: { type: "personal" },
    commerces,
  };
}

export { commercePk };
