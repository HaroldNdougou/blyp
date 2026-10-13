import { normalizeCameroonPhone } from "./phone.mjs";

const PUT_TTL_SEC = 300;

function assetsBucket() {
  return String(process.env.ASSETS_BUCKET ?? "").trim();
}

function cdnBase() {
  return String(process.env.ASSETS_CDN_URL ?? "").replace(/\/$/, "");
}

export function avatarObjectKey(phoneNine) {
  const nine = String(phoneNine ?? "").replace(/\D/g, "").slice(-9);
  if (!/^6\d{8}$/.test(nine)) return null;
  return `avatars/${nine}.jpg`;
}

export function publicAvatarUrl(phoneNine, versionMs) {
  const base = cdnBase();
  const key = avatarObjectKey(phoneNine);
  if (!base || !key) return null;
  const v = Number(versionMs) > 0 ? `?v=${Math.floor(versionMs)}` : "";
  return `${base}/${key}${v}`;
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

/** Presign PUT vers `avatars/{9 chiffres}.jpg` (servi par CloudFront). */
export async function presignAvatarUpload(userId, profilePhone, contentType) {
  const b = assetsBucket();
  if (!b) return { error: "ASSETS_UNAVAILABLE" };
  const phone = normalizeCameroonPhone(profilePhone);
  if (!phone) return { error: "PHONE_INVALID" };
  const key = avatarObjectKey(phone);
  if (!key) return { error: "PHONE_INVALID" };

  const { contentType: ct } = imageExtForContentType(contentType);

  const { client, PutObjectCommand, getSignedUrl } = await s3Signer();
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: b,
      Key: key,
      ContentType: ct,
      CacheControl: "public, max-age=31536000, immutable",
    }),
    { expiresIn: PUT_TTL_SEC },
  );
  return {
    uploadUrl,
    key,
    contentType: ct,
    expiresIn: PUT_TTL_SEC,
  };
}

export function isAvatarKeyForPhone(key, phoneNine) {
  const expected = avatarObjectKey(phoneNine);
  const k = String(key ?? "").trim();
  return Boolean(expected && k === expected);
}
