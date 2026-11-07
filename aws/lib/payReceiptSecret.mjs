import { createPrivateKey } from "node:crypto";

let privateKeyObj = null;
let loadPromise = null;

function normalizePem(raw) {
  const pem = String(raw ?? "")
    .trim()
    .replace(/\\n/g, "\n");
  return pem || null;
}

function pemFromEnv() {
  return normalizePem(process.env.PAY_RECEIPT_ED25519_PRIVATE_KEY_PEM);
}

function parseSecretString(secretString) {
  const raw = String(secretString ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("{")) {
    try {
      const j = JSON.parse(raw);
      return normalizePem(j.privateKeyPem ?? j.pem ?? j.PAY_RECEIPT_ED25519_PRIVATE_KEY_PEM);
    } catch {
      return null;
    }
  }
  return normalizePem(raw);
}

async function fetchPemFromSecretsManager() {
  const secretId =
    process.env.PAY_RECEIPT_ED25519_SECRET_ARN?.trim() ||
    process.env.PAY_RECEIPT_ED25519_SECRET_NAME?.trim();
  if (!secretId) return null;
  const { SecretsManagerClient, GetSecretValueCommand } = await import(
    "@aws-sdk/client-secrets-manager"
  );
  const client = new SecretsManagerClient({});
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  return parseSecretString(res.SecretString);
}

function importPrivateKey(raw) {
  const t = normalizePem(raw);
  if (!t) return null;
  if (t.includes("BEGIN")) {
    return createPrivateKey(t);
  }
  const b64 = t.replace(/\s/g, "");
  if (/^[A-Za-z0-9+/=]+$/.test(b64) && b64.length >= 32) {
    return createPrivateKey({
      key: Buffer.from(b64, "base64"),
      format: "der",
      type: "pkcs8",
    });
  }
  return createPrivateKey(t);
}

/** Charge la clé privée (env local ou Secrets Manager). Idempotent. */
export async function ensurePayReceiptPrivateKeyLoaded() {
  if (privateKeyObj) return privateKeyObj;
  if (!loadPromise) {
    loadPromise = (async () => {
      const pem = pemFromEnv() ?? (await fetchPemFromSecretsManager());
      if (!pem) return null;
      try {
        privateKeyObj = importPrivateKey(pem);
        return privateKeyObj;
      } catch (err) {
        loadPromise = null;
        throw err;
      }
    })();
  }
  return loadPromise;
}

export function getPayReceiptPrivateKeyOrNull() {
  return privateKeyObj;
}
