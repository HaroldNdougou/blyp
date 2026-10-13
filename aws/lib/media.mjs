import { randomUUID } from "node:crypto";

const MAX_DURATION_MS = 60_000;
const PUT_TTL_SEC = 300;
const GET_TTL_SEC = 600;

function bucket() {
  return String(process.env.MEDIA_BUCKET ?? "").trim();
}

function region() {
  return String(process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "af-south-1").trim();
}

function voiceKeyPrefix(conversationId, userId) {
  return `voice/${conversationId}/${userId}/`;
}

export function isOwnedVoiceKey(key, conversationId, userId) {
  const k = String(key ?? "").trim();
  if (!k || k.includes("..")) return false;
  return k.startsWith(voiceKeyPrefix(conversationId, userId)) && k.endsWith(".m4a");
}

export function isConvVoiceKey(key, conversationId) {
  const k = String(key ?? "").trim();
  if (!k || k.includes("..")) return false;
  return k.startsWith(`voice/${conversationId}/`) && k.endsWith(".m4a");
}

export function clampVoiceDurationMs(raw) {
  const n = Math.floor(Number(raw) || 0);
  if (n < 400) return 0;
  return Math.min(n, MAX_DURATION_MS);
}

async function s3Signer() {
  const [{ S3Client, PutObjectCommand, GetObjectCommand }, { getSignedUrl }] =
    await Promise.all([
      import("@aws-sdk/client-s3"),
      import("@aws-sdk/s3-request-presigner"),
    ]);
  const client = new S3Client({
    region: region(),
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return { client, PutObjectCommand, GetObjectCommand, getSignedUrl };
}

export async function presignVoiceUpload(userId, conversationId) {
  const b = bucket();
  if (!b) return { error: "MEDIA_UNAVAILABLE" };
  const key = `${voiceKeyPrefix(conversationId, userId)}${randomUUID()}.m4a`;
  const { client, PutObjectCommand, getSignedUrl } = await s3Signer();
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: b,
      Key: key,
      ContentType: "audio/mp4",
    }),
    { expiresIn: PUT_TTL_SEC },
  );
  return { uploadUrl, key, expiresIn: PUT_TTL_SEC };
}

export async function presignVoicePlay(conversationId, key) {
  const b = bucket();
  if (!b) return { error: "MEDIA_UNAVAILABLE" };
  if (!isConvVoiceKey(key, conversationId)) return { error: "KEY_INVALID" };
  const { client, GetObjectCommand, getSignedUrl } = await s3Signer();
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: b, Key: key }),
    { expiresIn: GET_TTL_SEC },
  );
  return { url, expiresIn: GET_TTL_SEC };
}

function imageKeyPrefix(conversationId, userId) {
  return `image/${conversationId}/${userId}/`;
}

function imageExtForContentType(contentType) {
  const ct = String(contentType ?? "").trim().toLowerCase();
  if (ct === "image/png") return { ext: "png", contentType: "image/png" };
  return { ext: "jpg", contentType: "image/jpeg" };
}

export function isOwnedImageKey(key, conversationId, userId) {
  const k = String(key ?? "").trim();
  if (!k || k.includes("..")) return false;
  if (!k.startsWith(imageKeyPrefix(conversationId, userId))) return false;
  return k.endsWith(".jpg") || k.endsWith(".jpeg") || k.endsWith(".png");
}

export function isConvImageKey(key, conversationId) {
  const k = String(key ?? "").trim();
  if (!k || k.includes("..")) return false;
  if (!k.startsWith(`image/${conversationId}/`)) return false;
  return k.endsWith(".jpg") || k.endsWith(".jpeg") || k.endsWith(".png");
}

export function clampImageDimensions(width, height) {
  const w = Math.floor(Number(width) || 0);
  const h = Math.floor(Number(height) || 0);
  const max = 8192;
  return {
    width: w > 0 ? Math.min(w, max) : 0,
    height: h > 0 ? Math.min(h, max) : 0,
  };
}

export async function presignImageUpload(userId, conversationId, contentType) {
  const b = bucket();
  if (!b) return { error: "MEDIA_UNAVAILABLE" };
  const { ext, contentType: ct } = imageExtForContentType(contentType);
  const key = `${imageKeyPrefix(conversationId, userId)}${randomUUID()}.${ext}`;
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

export async function presignImagePlay(conversationId, key) {
  const b = bucket();
  if (!b) return { error: "MEDIA_UNAVAILABLE" };
  if (!isConvImageKey(key, conversationId)) return { error: "KEY_INVALID" };
  const { client, GetObjectCommand, getSignedUrl } = await s3Signer();
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: b, Key: key }),
    { expiresIn: GET_TTL_SEC },
  );
  return { url, expiresIn: GET_TTL_SEC };
}
