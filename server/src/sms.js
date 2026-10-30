/**
 * Envoi SMS (fallback Obit) + OTP WhatsApp Meta Cloud API.
 */
import {
  metaWhatsAppConfigured,
  sendOtpViaMetaWhatsApp,
} from "./whatsappCloud.js";

let warnedMissingAndroidSmsHash = false;
let warnedMissingAndroidSmsHashProd = false;

/** Hashes 11 car. pour Google SMS Retriever (séparateurs , ou ;). Guillemets .env tolérés. */
function parseSmsRetrieverHashes() {
  const raw = String(process.env.ANDROID_SMS_OTP_APP_HASH ?? "").trim();
  const unquoted = raw.replace(/^["']|["']$/g, "");
  return unquoted
    .split(/[,;]+/)
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter((s) => s.length === 11);
}

function warnMissingAndroidSmsHashOnce() {
  if (warnedMissingAndroidSmsHash || process.env.NODE_ENV === "production") {
    return;
  }
  warnedMissingAndroidSmsHash = true;
  console.warn(
    "[SMS] ANDROID_SMS_OTP_APP_HASH absent : SMS = « Bonjour CODE » seul — pas d’auto-remplissage Android (SMS Retriever). " +
      "Logs Metro (__DEV__) sur l’écran OTP : [Blyp] ANDROID_SMS_OTP_APP_HASH=…",
  );
}

/**
 * Corps du SMS OTP. Avec ANDROID_SMS_OTP_APP_HASH (11 car. chacun, plusieurs séparés par virgule),
 * le hash est ajouté sur la même ligne : « Bonjour 609534 V9AbpjGCxBE » (SMS Retriever Android).
 */
function otpMessage(code) {
  const base = `Bonjour ${code}`;
  const hashes = parseSmsRetrieverHashes();
  if (hashes.length === 0) {
    warnMissingAndroidSmsHashOnce();
    if (
      process.env.NODE_ENV === "production" &&
      !warnedMissingAndroidSmsHashProd
    ) {
      warnedMissingAndroidSmsHashProd = true;
      const raw = String(process.env.ANDROID_SMS_OTP_APP_HASH ?? "").trim();
      console.warn(
        "[SMS] ANDROID_SMS_OTP_APP_HASH absent ou ≠ 11 car. après parsing — SMS sans hash Retriever. Valeur brute reçue :",
        raw ? JSON.stringify(raw) : "(vide)",
      );
    }
    return base;
  }
  return `${base} ${hashes.join(" ")}`;
}

/**
 * Valeur `ANDROID_SMS_OTP_APP_HASH` telle que lue par Node (ex. Railway), pour GET `/health`.
 */
export function androidOtpSmsHashHealthSnapshot() {
  const raw = String(process.env.ANDROID_SMS_OTP_APP_HASH ?? "").trim();
  const segments = parseSmsRetrieverHashes();
  return {
    envPresent: raw.length > 0,
    rawLength: raw.length,
    rawAsSeenByServer: raw,
    validSegmentCount: segments.length,
    valid11CharHashes: segments,
  };
}

/** Obit SMS API v2 — doc : GET bulksms, destination = 237 + 9 chiffres nationaux. */
function obitsmsConfigured() {
  return Boolean(
    process.env.OBIT_SMS_KEY_API?.trim() &&
      process.env.OBIT_SMS_SENDER?.trim(),
  );
}

async function sendViaObitsms(toE164, text) {
  const keyApi = process.env.OBIT_SMS_KEY_API.trim();
  const sender = process.env.OBIT_SMS_SENDER.trim();
  const base =
    process.env.OBIT_SMS_BASE_URL?.trim() ||
    "https://obitsms.com/api/v2/bulksms";

  const digits = String(toE164).replace(/\D/g, "");
  const national9 = digits.slice(-9);
  const destination = `237${national9}`;

  const qs = new URLSearchParams({
    key_api: keyApi,
    sender,
    destination,
    message: text,
  });
  const url = `${base.replace(/\/$/, "")}?${qs.toString()}`;

  const res = await fetch(url, { method: "GET" });
  const raw = (await res.text()).trim();

  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    console.error("[SMS Obit] réponse non-JSON:", res.status, raw);
    return { ok: false, detail: raw };
  }

  if (!res.ok) {
    console.error("[SMS Obit] HTTP", res.status, raw);
    return { ok: false, detail: raw };
  }

  if (data && data.success === true) {
    console.log(
      "[SMS Obit] accepté par Obit id=%s destination=%s sender=%s",
      data.id ?? "?",
      destination,
      sender,
    );
    return { ok: true };
  }

  const msg = data?.message ?? raw;
  console.error("[SMS Obit] échec:", data?.code, msg);
  return { ok: false, detail: msg };
}

function africasTalkingConfigured() {
  return Boolean(
    process.env.AFRICASTALKING_USERNAME && process.env.AFRICASTALKING_API_KEY,
  );
}

async function sendViaAfricasTalking(toE164, text) {
  const username = process.env.AFRICASTALKING_USERNAME;
  const apiKey = process.env.AFRICASTALKING_API_KEY;
  const host =
    process.env.AFRICASTALKING_API_HOST || "api.africastalking.com";
  const url = `https://${host}/version1/messaging`;

  const params = new URLSearchParams({
    username,
    to: toE164,
    message: text,
  });
  const from = process.env.AFRICASTALKING_SENDER_ID;
  if (from) params.set("from", from);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      apiKey,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const raw = await res.text();
  if (!res.ok) {
    console.error("[SMS Africa's Talking]", res.status, raw);
    return { ok: false, detail: raw };
  }
  try {
    const j = JSON.parse(raw);
    const recipients = j?.SMSMessageData?.Recipients;
    const first = Array.isArray(recipients) ? recipients[0] : null;
    const status = first?.status;
    if (status && String(status).toLowerCase() !== "success") {
      console.error("[SMS Africa's Talking] recipient status:", first);
      return { ok: false, detail: raw };
    }
  } catch {
    /* réponse non-JSON : considérer ok si HTTP 2xx */
  }
  return { ok: true };
}

function webhookConfigured() {
  return Boolean(process.env.SMS_WEBHOOK_URL?.trim());
}

async function sendViaWebhook(toE164, text) {
  const hookUrl = process.env.SMS_WEBHOOK_URL.trim();
  const headers = { "Content-Type": "application/json" };
  const bearer = process.env.SMS_WEBHOOK_BEARER_TOKEN;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const res = await fetch(hookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ to: toE164, message: text }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error("[SMS webhook]", res.status, errBody);
    return { ok: false, detail: errBody };
  }
  return { ok: true };
}

export function isOtpWhatsAppConfigured() {
  return metaWhatsAppConfigured();
}

function smsProviderExplicit() {
  const p = String(process.env.SMS_PROVIDER || "")
    .trim()
    .toLowerCase();
  if (!p) return null;
  if (["obitsms", "obit"].includes(p)) return "obitsms";
  if (["africastalking", "at", "africa"].includes(p)) return "africastalking";
  if (["webhook", "http"].includes(p)) return "webhook";
  return null;
}

function anySmsConfigured() {
  return (
    obitsmsConfigured() ||
    africasTalkingConfigured() ||
    webhookConfigured()
  );
}

/**
 * État SMS pour /health et logs au démarrage (ne contient pas de secrets).
 * @returns {{ sendingSms: boolean, provider: string | null, devOtpInLogs?: boolean, misconfigured?: boolean }}
 */
export function describeSmsSetup() {
  const prod = process.env.NODE_ENV === "production";
  const explicit = smsProviderExplicit();

  if (explicit === "obitsms") {
    if (obitsmsConfigured())
      return { sendingSms: true, provider: "obitsms" };
    return {
      sendingSms: false,
      provider: "obitsms",
      misconfigured: true,
      devOtpInLogs: !prod,
    };
  }
  if (explicit === "africastalking") {
    if (africasTalkingConfigured())
      return { sendingSms: true, provider: "africastalking" };
    return {
      sendingSms: false,
      provider: "africastalking",
      misconfigured: true,
      devOtpInLogs: !prod,
    };
  }
  if (explicit === "webhook") {
    if (webhookConfigured())
      return { sendingSms: true, provider: "webhook" };
    return {
      sendingSms: false,
      provider: "webhook",
      misconfigured: true,
      devOtpInLogs: !prod,
    };
  }

  if (obitsmsConfigured()) return { sendingSms: true, provider: "obitsms" };
  if (africasTalkingConfigured())
    return { sendingSms: true, provider: "africastalking" };
  if (webhookConfigured()) return { sendingSms: true, provider: "webhook" };

  return {
    sendingSms: false,
    provider: null,
    devOtpInLogs: !prod,
  };
}

/**
 * OTP : WhatsApp Meta Cloud ; SMS si OTP_SMS_FALLBACK=1.
 */
export async function deliverOtpSms(phoneE164, code) {
  if (metaWhatsAppConfigured()) {
    const wa = await sendOtpViaMetaWhatsApp(phoneE164, code);
    if (wa.ok) return { ok: true, channel: "whatsapp" };
    console.warn("[OTP WhatsApp Cloud]", wa.reason ?? "provider_failed");
  }

  const smsFallback =
    String(process.env.OTP_SMS_FALLBACK ?? "")
      .trim()
      .toLowerCase() === "1";
  if (smsFallback) {
    const text = otpMessage(code);
    const explicit = smsProviderExplicit();

    const trySend = async () => {
      if (explicit === "obitsms") {
        if (!obitsmsConfigured())
          return { ok: false, reason: "sms_not_configured" };
        const r = await sendViaObitsms(phoneE164, text);
        return r.ok ? { ok: true } : { ok: false, reason: "provider_failed" };
      }
      if (explicit === "africastalking") {
        if (!africasTalkingConfigured())
          return { ok: false, reason: "sms_not_configured" };
        const r = await sendViaAfricasTalking(phoneE164, text);
        return r.ok ? { ok: true } : { ok: false, reason: "provider_failed" };
      }
      if (explicit === "webhook") {
        if (!webhookConfigured())
          return { ok: false, reason: "sms_not_configured" };
        const r = await sendViaWebhook(phoneE164, text);
        return r.ok ? { ok: true } : { ok: false, reason: "provider_failed" };
      }

      if (obitsmsConfigured()) {
        const r = await sendViaObitsms(phoneE164, text);
        return r.ok ? { ok: true } : { ok: false, reason: "provider_failed" };
      }
      if (africasTalkingConfigured()) {
        const r = await sendViaAfricasTalking(phoneE164, text);
        return r.ok ? { ok: true } : { ok: false, reason: "provider_failed" };
      }
      if (webhookConfigured()) {
        const r = await sendViaWebhook(phoneE164, text);
        return r.ok ? { ok: true } : { ok: false, reason: "provider_failed" };
      }
      return { ok: false, reason: "sms_not_configured" };
    };

    const sms = await trySend();
    if (sms.ok) return { ok: true, channel: "sms" };
    return { ok: false, reason: "sms_failed" };
  }

  if (!metaWhatsAppConfigured()) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[OTP] Production : WHATSAPP_CLOUD_TOKEN + WHATSAPP_PHONE_NUMBER_ID",
      );
      return { ok: false, reason: "whatsapp_not_configured" };
    }
    console.log(`[OTP dev] ${phoneE164} → ${code} (Meta WhatsApp non configuré)`);
    return { ok: true, channel: "dev_log" };
  }

  return { ok: false, reason: "whatsapp_failed" };
}

export { anySmsConfigured };

