/**
 * WhatsApp Cloud API (Meta) — OTP authentication templates.
 */

function graphVersion() {
  return String(process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0").trim() || "v21.0";
}

export function metaWhatsAppConfigured() {
  return Boolean(
    process.env.WHATSAPP_CLOUD_TOKEN?.trim() &&
      process.env.WHATSAPP_PHONE_NUMBER_ID?.trim(),
  );
}

function whatsappRecipientDigits(phoneE164) {
  return String(phoneE164 ?? "").replace(/\D/g, "");
}

function otpTemplateName() {
  return String(process.env.WHATSAPP_OTP_TEMPLATE_NAME ?? "blyp_otp").trim() || "blyp_otp";
}

function otpTemplateLang() {
  return String(process.env.WHATSAPP_OTP_TEMPLATE_LANG ?? "fr").trim() || "fr";
}

function otpTemplateComponents(code) {
  const components = [
    {
      type: "body",
      parameters: [{ type: "text", text: String(code) }],
    },
  ];
  const copyBtn =
    String(process.env.WHATSAPP_OTP_COPY_CODE_BUTTON ?? "1")
      .trim()
      .toLowerCase() !== "0";
  if (copyBtn) {
    components.push({
      type: "button",
      sub_type: "copy_code",
      index: "0",
      parameters: [{ type: "text", text: String(code) }],
    });
  }
  return components;
}

export async function sendOtpViaMetaWhatsApp(phoneE164, code) {
  if (!metaWhatsAppConfigured()) {
    return { ok: false, reason: "whatsapp_not_configured" };
  }
  const to = whatsappRecipientDigits(phoneE164);
  if (to.length < 9) return { ok: false, reason: "invalid_phone" };

  const token = process.env.WHATSAPP_CLOUD_TOKEN.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID.trim();
  const url = `https://graph.facebook.com/${graphVersion()}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: otpTemplateName(),
      language: { code: otpTemplateLang() },
      components: otpTemplateComponents(code),
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  if (!res.ok) {
    console.error("[WhatsApp Cloud OTP]", res.status, raw);
    return { ok: false, reason: "provider_failed", detail: raw };
  }
  return { ok: true };
}
