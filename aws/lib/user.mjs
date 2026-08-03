import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import {
  accountPk,
  fallbackAccountId,
  makeAccountId,
  resolveAccountId,
} from "./accountId.mjs";
import { getDocClient, getTableName, ttlFromNowMs } from "./dynamodb.mjs";

const doc = getDocClient();

function phonePk(phone) {
  return `PHONE#${phone}`;
}

function userPk(userId) {
  return `USER#${userId}`;
}

export { userPk };

function otpPk(phone) {
  return `OTP#${phone}`;
}

function trimStr(s) {
  return String(s ?? "").trim();
}

function getOnboardingStep(profile) {
  if (!profile?.transactionPinHash) return "pin";
  if (!trimStr(profile.firstName) || !trimStr(profile.lastName)) return "profile";
  return null;
}

export function userToApi(profile, balanceFcfa = 0) {
  const onboardingStep = getOnboardingStep(profile);
  return {
    /** ID compte public (ex. BLYP-U-…) — pas l’UUID interne. */
    id: resolveAccountId(profile),
    phone: profile.phone,
    balanceFcfa,
    needsOnboarding: onboardingStep != null,
    onboardingStep,
    firstName: profile.firstName ?? null,
    lastName: profile.lastName ?? null,
  };
}

/**
 * Assigne un `accountId` public unique si absent (backfill anciens comptes).
 * @param {string} userId
 * @param {Record<string, unknown> | null} profile
 */
export async function ensureAccountId(userId, profile) {
  if (profile?.accountId) return String(profile.accountId);
  for (let attempt = 0; attempt < 5; attempt++) {
    const accountId = makeAccountId();
    const now = new Date().toISOString();
    try {
      await doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: getTableName(),
                Key: { PK: userPk(userId), SK: "PROFILE" },
                UpdateExpression: "SET accountId = :a, updatedAt = :now",
                ConditionExpression:
                  "attribute_exists(PK) AND attribute_not_exists(accountId)",
                ExpressionAttributeValues: {
                  ":a": accountId,
                  ":now": now,
                },
              },
            },
            {
              Put: {
                TableName: getTableName(),
                Item: {
                  PK: accountPk(accountId),
                  SK: "META",
                  userId,
                  accountId,
                  createdAt: now,
                },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
          ],
        }),
      );
      return accountId;
    } catch (err) {
      if (err?.name !== "TransactionCanceledException") throw err;
      const fresh = await getUserProfile(userId);
      if (fresh?.accountId) return String(fresh.accountId);
    }
  }
  return fallbackAccountId(userId);
}

export async function getUserIdByPhone(phone) {
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: phonePk(phone), SK: "META" },
    }),
  );
  return res.Item?.userId ?? null;
}

export async function getUserProfile(userId) {
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK: "PROFILE" },
    }),
  );
  return res.Item ?? null;
}

export async function getUserBalance(userId) {
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK: "BALANCE" },
    }),
  );
  return Number(res.Item?.balanceFcfa ?? 0);
}

export async function getUserApiPayload(userId) {
  const [profile, balanceFcfa] = await Promise.all([
    getUserProfile(userId),
    getUserBalance(userId),
  ]);
  if (!profile) return null;
  if (!profile.userId) profile.userId = userId;
  if (!profile.accountId) {
    profile.accountId = await ensureAccountId(userId, profile);
  }
  return userToApi(profile, balanceFcfa);
}

export async function getOtpCooldown(phone) {
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: otpPk(phone), SK: "COOLDOWN" },
    }),
  );
  return res.Item ?? null;
}

export async function setOtpCooldown(phone) {
  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: otpPk(phone),
        SK: "COOLDOWN",
        expiresAt: ttlFromNowMs(60_000),
      },
    }),
  );
}

export async function clearOtpCooldown(phone) {
  await doc.send(
    new DeleteCommand({
      TableName: getTableName(),
      Key: { PK: otpPk(phone), SK: "COOLDOWN" },
    }),
  );
}

export async function putOtpChallenge(phone, codeHash) {
  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: otpPk(phone),
        SK: "CHALLENGE",
        codeHash,
        expiresAt: ttlFromNowMs(10 * 60 * 1000),
        createdAt: new Date().toISOString(),
      },
    }),
  );
}

export async function deleteOtpChallenge(phone) {
  await doc.send(
    new DeleteCommand({
      TableName: getTableName(),
      Key: { PK: otpPk(phone), SK: "CHALLENGE" },
    }),
  );
}

export async function getOtpChallenge(phone) {
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: otpPk(phone), SK: "CHALLENGE" },
    }),
  );
  return res.Item ?? null;
}

export async function logOtpSend(phone) {
  const now = new Date().toISOString();
  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: otpPk(phone),
        SK: `SEND#${now}`,
        sentAt: now,
        expiresAt: ttlFromNowMs(90 * 24 * 60 * 60 * 1000),
      },
    }),
  );
}

export async function getOtpVerifyCache(cacheKey) {
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: "IDEM#otp-verify", SK: cacheKey },
    }),
  );
  if (!res.Item?.payload) return null;
  try {
    return JSON.parse(res.Item.payload);
  } catch {
    return null;
  }
}

export async function putOtpVerifyCache(cacheKey, payload) {
  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: "IDEM#otp-verify",
        SK: cacheKey,
        payload: JSON.stringify(payload),
        expiresAt: ttlFromNowMs(120_000),
      },
    }),
  );
}

export async function findOrCreateUserByPhone(phone) {
  const existingId = await getUserIdByPhone(phone);
  if (existingId) {
    const user = await getUserApiPayload(existingId);
    return { userId: existingId, user, isNewAccount: false };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const userId = randomUUID();
    const accountId = makeAccountId();
    const now = new Date().toISOString();

    try {
      await doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: getTableName(),
                Item: {
                  PK: phonePk(phone),
                  SK: "META",
                  userId,
                  phone,
                  createdAt: now,
                },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Put: {
                TableName: getTableName(),
                Item: {
                  PK: userPk(userId),
                  SK: "PROFILE",
                  userId,
                  accountId,
                  phone,
                  firstName: null,
                  lastName: null,
                  createdAt: now,
                  updatedAt: now,
                },
              },
            },
            {
              Put: {
                TableName: getTableName(),
                Item: {
                  PK: userPk(userId),
                  SK: "BALANCE",
                  userId,
                  balanceFcfa: 0,
                  updatedAt: now,
                },
              },
            },
            {
              Put: {
                TableName: getTableName(),
                Item: {
                  PK: accountPk(accountId),
                  SK: "META",
                  userId,
                  accountId,
                  createdAt: now,
                },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
          ],
        }),
      );

      const user = await getUserApiPayload(userId);
      return { userId, user, isNewAccount: true };
    } catch (err) {
      if (err?.name !== "TransactionCanceledException") throw err;
      const raced = await getUserIdByPhone(phone);
      if (raced) {
        const user = await getUserApiPayload(raced);
        return { userId: raced, user, isNewAccount: false };
      }
      /* collision accountId rare → nouvel essai */
    }
  }
  throw new Error("Unable to create user account");
}

export async function findOrCreateUserByPhoneSafe(phone) {
  try {
    return await findOrCreateUserByPhone(phone);
  } catch (err) {
    if (err?.name !== "TransactionCanceledException") throw err;
    const existingId = await getUserIdByPhone(phone);
    if (!existingId) throw err;
    const user = await getUserApiPayload(existingId);
    return { userId: existingId, user, isNewAccount: false };
  }
}

export async function setTransactionPin(userId, pinHash) {
  const now = new Date().toISOString();
  await doc.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK: "PROFILE" },
      UpdateExpression: "SET transactionPinHash = :hash, updatedAt = :now",
      ConditionExpression: "attribute_not_exists(transactionPinHash)",
      ExpressionAttributeValues: {
        ":hash": pinHash,
        ":now": now,
      },
    }),
  );
}

export async function updateProfileNames(userId, firstName, lastName) {
  const now = new Date().toISOString();
  await doc.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK: "PROFILE" },
      UpdateExpression: "SET firstName = :fn, lastName = :ln, updatedAt = :now",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeValues: {
        ":fn": firstName,
        ":ln": lastName,
        ":now": now,
      },
    }),
  );
}
