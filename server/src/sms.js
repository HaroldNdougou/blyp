/**
 * Envoi SMS (OTP) — fournisseur choisi par variables d’environnement.
 * Détection (dans l’ordre) : Obit SMS, Africa’s Talking, webhook HTTP, Twilio (optionnel).
 * Sans rien en prod → erreur ; en dev → code loggé dans la console.
 */

function otpMessage(code) {
  return `Blyp Pay — code : ${code}. Valide 10 min. Ne partagez pas ce code.`;
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

function twilioConfigured() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const ms = process.env.TWILIO_MESSAGING_SERVICE_SID;
  return Boolean(sid && token && (from || ms));
}

async function sendViaTwilio(toE164, text) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ To: toE164, Body: text });
  if (messagingServiceSid) {
    params.set("MessagingServiceSid", messagingServiceSid);
  } else if (fromNumber) {
    params.set("From", fromNumber);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error("[SMS Twilio]", res.status, errBody);
    return { ok: false, detail: errBody };
  }
  return { ok: true };
}

function smsProviderExplicit() {
  const p = String(process.env.SMS_PROVIDER || "")
    .trim()
    .toLowerCase();
  if (!p) return null;
  if (["obitsms", "obit"].includes(p)) return "obitsms";
  if (["africastalking", "at", "africa"].includes(p)) return "africastalking";
  if (["webhook", "http"].includes(p)) return "webhook";
  if (p === "twilio") return "twilio";
  return null;
}

function anySmsConfigured() {
  return (
    obitsmsConfigured() ||
    africasTalkingConfigured() ||
    webhookConfigured() ||
    twilioConfigured()
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
  if (explicit === "twilio") {
    if (twilioConfigured())
      return { sendingSms: true, provider: "twilio" };
    return {
      sendingSms: false,
      provider: "twilio",
      misconfigured: true,
      devOtpInLogs: !prod,
    };
  }

  if (obitsmsConfigured()) return { sendingSms: true, provider: "obitsms" };
  if (africasTalkingConfigured())
    return { sendingSms: true, provider: "africastalking" };
  if (webhookConfigured()) return { sendingSms: true, provider: "webhook" };
  if (twilioConfigured()) return { sendingSms: true, provider: "twilio" };

  return {
    sendingSms: false,
    provider: null,
    devOtpInLogs: !prod,
  };
}

/**
 * @param {string} phoneE164 ex. +237612345678
 * @param {string} code 6 chiffres
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function deliverOtpSms(phoneE164, code) {
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
    if (explicit === "twilio") {
      if (!twilioConfigured())
        return { ok: false, reason: "sms_not_configured" };
      const r = await sendViaTwilio(phoneE164, text);
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
    if (twilioConfigured()) {
      const r = await sendViaTwilio(phoneE164, text);
      return r.ok ? { ok: true } : { ok: false, reason: "provider_failed" };
    }
    return { ok: false, reason: "sms_not_configured" };
  };

  const result = await trySend();

  if (result.ok) return result;

  if (result.reason === "sms_not_configured") {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[SMS] Production : configure Obit (OBIT_SMS_*), Africa’s Talking, SMS_WEBHOOK_URL ou Twilio — voir server/.env.example",
      );
      return { ok: false, reason: "sms_not_configured" };
    }
    console.log(`[OTP dev] ${phoneE164} → ${code}`);
    return { ok: true };
  }

  return result;
}

export { anySmsConfigured };
