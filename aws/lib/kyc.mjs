import { randomUUID } from "node:crypto";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getDocClient, getTableName } from "./dynamodb.mjs";
import { userPk } from "./user.mjs";

const PUT_TTL_SEC = 300;

export const KYC_TX_MAX_UNVERIFIED = 100_000;
export const KYC_TX_MAX_VERIFIED = 999_999;

const doc = getDocClient();

function mediaBucket() {
  return String(process.env.MEDIA_BUCKET ?? "").trim();
}

function kycKeyPrefix(userId) {
  return `kyc/${userId}/`;
}

export function isOwnedKycKey(key, userId) {
  const k = String(key ?? "").trim();
  if (!k || k.includes("..")) return false;
  const prefix = kycKeyPrefix(userId);
  if (!k.startsWith(prefix)) return false;
  return /\.(jpg|jpeg|png)$/i.test(k);
}

export function maxTxFcfaForProfile(profile) {
  if (profile?.kycStatus === "approved") return KYC_TX_MAX_VERIFIED;
  return KYC_TX_MAX_UNVERIFIED;
}

function imageExtForContentType(contentType) {
  const ct = String(contentType ?? "").trim().toLowerCase();
  if (ct === "image/png") return { ext: "png", contentType: "image/png" };
  return { ext: "jpg", contentType: "image/jpeg" };
}

async function s3Signer() {
  const [{ S3Client, PutObjectCommand }, { getSignedUrl }] = await Promise.all([
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
  return { client, PutObjectCommand, getSignedUrl };
}

const VALID_SIDES = new Set(["front", "back", "selfie"]);
const VALID_DOC = new Set(["national_id", "passport"]);

export async function presignKycDocumentUpload(userId, docType, side, contentType) {
  const b = mediaBucket();
  if (!b) return { error: "KYC_STORAGE_UNAVAILABLE" };
  const dt = String(docType ?? "").trim();
  const sd = String(side ?? "").trim();
  if (!VALID_DOC.has(dt) || !VALID_SIDES.has(sd)) {
    return { error: "INVALID_INPUT" };
  }
  const { ext, contentType: ct } = imageExtForContentType(contentType);
  const key = `${kycKeyPrefix(userId)}${randomUUID()}-${sd}.${ext}`;
  const { client, PutObjectCommand, getSignedUrl } = await s3Signer();
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: b,
      Key: key,
      ContentType: ct,
    }),
    { expiresIn: PUT_TTL_SEC },
  );
  return { uploadUrl, key, contentType: ct, expiresIn: PUT_TTL_SEC };
}

function shouldAutoApproveKyc() {
  const flag = String(process.env.KYC_AUTO_APPROVE ?? "").trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  if (flag === "dev" || flag === "development" || flag === "staging") return true;
  const stage = String(process.env.STAGE ?? process.env.NODE_ENV ?? "").toLowerCase();
  return stage === "dev" || stage === "development" || stage === "staging";
}

export async function submitKycApplication(userId, body) {
  const docType = String(body?.docType ?? "").trim();
  const frontKey = String(body?.frontKey ?? "").trim();
  const backKey = String(body?.backKey ?? "").trim();
  const selfieKey = String(body?.selfieKey ?? "").trim();
  if (!VALID_DOC.has(docType)) return { error: "INVALID_DOC" };
  if (!isOwnedKycKey(frontKey, userId) || !isOwnedKycKey(selfieKey, userId)) {
    return { error: "INVALID_KEY" };
  }
  if (docType === "national_id" && !backKey) {
    return { error: "BACK_REQUIRED" };
  }
  if (backKey && !isOwnedKycKey(backKey, userId)) {
    return { error: "INVALID_KEY" };
  }

  const now = new Date().toISOString();
  const auto = shouldAutoApproveKyc();
  const kycStatus = auto ? "approved" : "pending";
  const kycLevel = auto ? 1 : 0;

  const sets = [
    "kycStatus = :st",
    "kycLevel = :lv",
    "kycDocType = :dt",
    "kycFrontKey = :fk",
    "kycSelfieKey = :sk",
    "kycSubmittedAt = :now",
    "updatedAt = :now",
  ];
  const values = {
    ":st": kycStatus,
    ":lv": kycLevel,
    ":dt": docType,
    ":fk": frontKey,
    ":sk": selfieKey,
    ":now": now,
  };
  if (backKey) {
    sets.push("kycBackKey = :bk");
    values[":bk"] = backKey;
  }
  if (auto) {
    sets.push("kycVerifiedAt = :now");
  }
  await doc.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { PK: userPk(userId), SK: "PROFILE" },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeValues: values,
    }),
  );

  return { ok: true, kycStatus, kycLevel };
}
