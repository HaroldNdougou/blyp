import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
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
    phone: profile.phone,
    balanceFcfa,
    needsOnboarding: onboardingStep != null,
    onboardingStep,
    firstName: profile.firstName ?? null,
    lastName: profile.lastName ?? null,
  };
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

  const userId = randomUUID();
  const now = new Date().toISOString();

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
      ],
    }),
  );

  const user = await getUserApiPayload(userId);
  return { userId, user, isNewAccount: true };
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
