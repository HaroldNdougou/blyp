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

function isImageObjectKey(k) {
  return (
    k.endsWith(".jpg") ||
    k.endsWith(".jpeg") ||
    k.endsWith(".png") ||
    k.endsWith(".thumb.jpg")
  );
}

export function isOwnedImageKey(key, conversationId, userId) {
  const k = String(key ?? "").trim();
  if (!k || k.includes("..")) return false;
  if (!k.startsWith(imageKeyPrefix(conversationId, userId))) return false;
  return isImageObjectKey(k);
}

export function isConvImageKey(key, conversationId) {
  const k = String(key ?? "").trim();
  if (!k || k.includes("..")) return false;
  if (!k.startsWith(`image/${conversationId}/`)) return false;
  return isImageObjectKey(k);
}

export function isOwnedImageThumbKey(key, conversationId, userId) {
  const k = String(key ?? "").trim();
  if (!k || !k.endsWith(".thumb.jpg")) return false;
  if (!k.startsWith(imageKeyPrefix(conversationId, userId))) return false;
  return true;
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
  const id = randomUUID();
  const key = `${imageKeyPrefix(conversationId, userId)}${id}.${ext}`;
  const thumbKey = `${imageKeyPrefix(conversationId, userId)}${id}.thumb.jpg`;
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
  const thumbUploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: b,
      Key: thumbKey,
      ContentType: "image/jpeg",
    }),
    { expiresIn: PUT_TTL_SEC },
  );
  return {
    uploadUrl,
    key,
    thumbUploadUrl,
    thumbKey,
    contentType: ct,
    expiresIn: PUT_TTL_SEC,
  };
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

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

function documentKeyPrefix(conversationId, userId) {
  return `doc/${conversationId}/${userId}/`;
}

export function extFromFileName(fileName) {
  const base = String(fileName ?? "").trim();
  const m = base.match(/\.([a-zA-Z0-9]{1,8})$/);
  if (!m) return { ext: "bin", contentType: "application/octet-stream" };
  const ext = m[1].toLowerCase();
  const map = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    zip: "application/zip",
    csv: "text/csv",
  };
  return {
    ext,
    contentType: map[ext] ?? "application/octet-stream",
  };
}

export function sanitizeDocumentFileName(raw) {
  const name = String(raw ?? "")
    .replace(/[/\\<>:"|?*\u0000-\u001f]/g, "_")
    .trim();
  if (!name) return "document";
  return name.length > 180 ? `${name.slice(0, 177)}…` : name;
}

export function clampDocumentSizeBytes(raw) {
  const n = Math.floor(Number(raw) || 0);
  if (n <= 0) return 0;
  return Math.min(n, MAX_DOCUMENT_BYTES);
}

export function isOwnedDocumentKey(key, conversationId, userId) {
  const k = String(key ?? "").trim();
  if (!k || k.includes("..")) return false;
  if (!k.startsWith(documentKeyPrefix(conversationId, userId))) return false;
  return /\.[a-zA-Z0-9]{1,8}$/.test(k);
}

export function isConvDocumentKey(key, conversationId) {
  const k = String(key ?? "").trim();
  if (!k || k.includes("..")) return false;
  return k.startsWith(`doc/${conversationId}/`);
}

export async function presignDocumentUpload(
  userId,
  conversationId,
  contentType,
  fileName,
) {
  const b = bucket();
  if (!b) return { error: "MEDIA_UNAVAILABLE" };
  const fromName = extFromFileName(fileName);
  const ct = String(contentType ?? "").trim() || fromName.contentType;
  const ext = fromName.ext;
  const key = `${documentKeyPrefix(conversationId, userId)}${randomUUID()}.${ext}`;
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

export async function presignDocumentDownload(conversationId, key) {
  const b = bucket();
  if (!b) return { error: "MEDIA_UNAVAILABLE" };
  if (!isConvDocumentKey(key, conversationId)) return { error: "KEY_INVALID" };
  const { client, GetObjectCommand, getSignedUrl } = await s3Signer();
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: b, Key: key }),
    { expiresIn: GET_TTL_SEC },
  );
  return { url, expiresIn: GET_TTL_SEC };
}

function documentThumbKeyPrefix(conversationId, userId) {
  return `doc-thumb/${conversationId}/${userId}/`;
}

export function isOwnedDocumentThumbKey(key, conversationId, userId) {
  const k = String(key ?? "").trim();
  if (!k || k.includes("..")) return false;
  if (!k.startsWith(documentThumbKeyPrefix(conversationId, userId))) return false;
  return k.endsWith(".jpg") || k.endsWith(".jpeg");
}

export function isConvDocumentThumbKey(key, conversationId) {
  const k = String(key ?? "").trim();
  if (!k || k.includes("..")) return false;
  return k.startsWith(`doc-thumb/${conversationId}/`);
}

export function clampDocumentPageCount(raw) {
  const n = Math.floor(Number(raw) || 0);
  if (n <= 0) return 0;
  return Math.min(n, 9999);
}

/** Vignette JPEG (page 1) — même modèle que WhatsApp (objet séparé du PDF). */
export async function presignDocumentThumbUpload(userId, conversationId) {
  const b = bucket();
  if (!b) return { error: "MEDIA_UNAVAILABLE" };
  const key = `${documentThumbKeyPrefix(conversationId, userId)}${randomUUID()}.jpg`;
  const { client, PutObjectCommand, getSignedUrl } = await s3Signer();
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: b,
      Key: key,
      ContentType: "image/jpeg",
    }),
    { expiresIn: PUT_TTL_SEC },
  );
  return { uploadUrl, key, contentType: "image/jpeg", expiresIn: PUT_TTL_SEC };
}

export async function presignDocumentThumbDownload(conversationId, key) {
  const b = bucket();
  if (!b) return { error: "MEDIA_UNAVAILABLE" };
  if (!isConvDocumentThumbKey(key, conversationId)) {
    return { error: "KEY_INVALID" };
  }
  const { client, GetObjectCommand, getSignedUrl } = await s3Signer();
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: b, Key: key }),
    { expiresIn: GET_TTL_SEC },
  );
  return { url, expiresIn: GET_TTL_SEC };
}

async function copyObjectInBucket(sourceKey, destKey) {
  const b = bucket();
  if (!b) return { error: "MEDIA_UNAVAILABLE" };
  const src = String(sourceKey ?? "").trim();
  const dst = String(destKey ?? "").trim();
  if (!src || !dst || src.includes("..") || dst.includes("..")) {
    return { error: "KEY_INVALID" };
  }
  const { S3Client, CopyObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: region(),
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const copySource = encodeURIComponent(`${b}/${src}`);
  try {
    await client.send(
      new CopyObjectCommand({
        Bucket: b,
        CopySource: copySource,
        Key: dst,
      }),
    );
    return { ok: true };
  } catch {
    return { error: "COPY_FAILED" };
  }
}

export async function duplicateVoiceKeyForConversation(
  userId,
  sourceConversationId,
  targetConversationId,
  sourceKey,
) {
  const src = String(sourceKey ?? "").trim();
  if (!isConvVoiceKey(src, sourceConversationId)) {
    return { error: "KEY_INVALID" };
  }
  const destKey = `${voiceKeyPrefix(targetConversationId, userId)}${randomUUID()}.m4a`;
  const copied = await copyObjectInBucket(src, destKey);
  if (copied.error) return copied;
  return { key: destKey };
}

export async function duplicateImageKeyForConversation(
  userId,
  sourceConversationId,
  targetConversationId,
  sourceKey,
) {
  const src = String(sourceKey ?? "").trim();
  if (!isConvImageKey(src, sourceConversationId)) {
    return { error: "KEY_INVALID" };
  }
  const ext = src.endsWith(".png") ? "png" : "jpg";
  const destKey = `${imageKeyPrefix(targetConversationId, userId)}${randomUUID()}.${ext}`;
  const copied = await copyObjectInBucket(src, destKey);
  if (copied.error) return copied;
  return { key: destKey };
}

export async function duplicateDocumentKeyForConversation(
  userId,
  sourceConversationId,
  targetConversationId,
  sourceKey,
  fileName,
) {
  const src = String(sourceKey ?? "").trim();
  if (!isConvDocumentKey(src, sourceConversationId)) {
    return { error: "KEY_INVALID" };
  }
  const { ext } = extFromFileName(fileName);
  const destKey = `${documentKeyPrefix(targetConversationId, userId)}${randomUUID()}.${ext}`;
  const copied = await copyObjectInBucket(src, destKey);
  if (copied.error) return copied;
  return { key: destKey };
}

export async function duplicateDocumentThumbKeyForConversation(
  userId,
  sourceConversationId,
  targetConversationId,
  sourceKey,
) {
  const src = String(sourceKey ?? "").trim();
  if (!src) return { key: null };
  if (!isConvDocumentThumbKey(src, sourceConversationId)) {
    return { error: "KEY_INVALID" };
  }
  const destKey = `${documentThumbKeyPrefix(targetConversationId, userId)}${randomUUID()}.jpg`;
  const copied = await copyObjectInBucket(src, destKey);
  if (copied.error) return copied;
  return { key: destKey };
}

function statusKeyPrefix(userId) {
  return `status/${userId}/`;
}

export function isOwnedStatusKey(key, userId) {
  const k = String(key ?? "").trim();
  if (!k || k.includes("..")) return false;
  if (!k.startsWith(statusKeyPrefix(userId))) return false;
  return (
    k.endsWith(".jpg") ||
    k.endsWith(".jpeg") ||
    k.endsWith(".png")
  );
}

export function isStatusObjectKey(key) {
  const k = String(key ?? "").trim();
  if (!k || k.includes("..")) return false;
  if (!k.startsWith("status/")) return false;
  return (
    k.endsWith(".jpg") ||
    k.endsWith(".jpeg") ||
    k.endsWith(".png")
  );
}

export async function presignStatusUpload(userId, contentType) {
  const b = bucket();
  if (!b) return { error: "MEDIA_UNAVAILABLE" };
  const { ext, contentType: ct } = imageExtForContentType(contentType);
  const key = `${statusKeyPrefix(userId)}${randomUUID()}.${ext}`;
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

export async function presignStatusPlay(key) {
  const b = bucket();
  if (!b) return { error: "MEDIA_UNAVAILABLE" };
  if (!isStatusObjectKey(key)) return { error: "KEY_INVALID" };
  const { client, GetObjectCommand, getSignedUrl } = await s3Signer();
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: b, Key: key }),
    { expiresIn: GET_TTL_SEC },
  );
  return { url, expiresIn: GET_TTL_SEC };
}
