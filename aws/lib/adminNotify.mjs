import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { adminConfig } from "./adminAuth.mjs";
import { listAdminDevices, deleteAdminDeviceByToken } from "./adminDevices.mjs";
import { listDeviceTokens } from "./devices.mjs";
import { normalizeCameroonPhone } from "./phone.mjs";
import { getUserIdByPhone } from "./user.mjs";

/**
 * Notifications fondateur : push (app admin) + email (SES).
 * Tout est best-effort : un échec d'envoi ne doit jamais perdre l'événement.
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const ses = new SESv2Client({});

export function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fcfa(n) {
  const v = Math.round(Number(n) || 0);
  return `${v.toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, " ")} FCFA`;
}

export function formatPhone(p) {
  const digits = String(p ?? "").replace(/\D/g, "");
  if (!digits) return "—";
  const national = digits.length > 9 ? digits.slice(-9) : digits;
  return `+237 ${national.replace(/(\d{1})(\d{2})(\d{2})(\d{2})(\d{2})/, "$1 $2 $3 $4 $5")}`;
}

/** Heure locale Cameroun lisible. */
export function formatLocal(iso) {
  const d = new Date(Date.parse(iso) + 3_600_000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(
    d.getUTCHours(),
  )}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

const MESSAGE_KIND_FR = {
  text: "Message",
  voice: "Vocal",
  image: "Photo",
  document: "Doc",
};

function whoShort(ev) {
  const name = String(ev.name ?? "").trim();
  if (name) return name.split(/\s+/)[0];
  const digits = String(ev.phone ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length > 9 ? digits.slice(-9) : digits;
}

function amountShort(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, " ");
}

function amountF(n) {
  return `${Math.max(0, Math.round(Number(n) || 0))}F`;
}

function requestPhone(ev) {
  const raw = ev.phone || ev.data?.phone || ev.data?.destination || "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 9) return "";
  const n = digits.slice(-9);
  return n.replace(/(\d{3})(\d{2})(\d{2})(\d{2})/, "$1 $2 $3 $4");
}

function brief(title, lines, severity) {
  return { title, summary: title, lines, severity };
}

/**
 * Une seule ligne, pour la notification et le mail.
 * @returns {{ title: string, summary: string, lines: Array<[string,string]>, severity: "info"|"money"|"alert" }}
 */
export function describeEvent(ev) {
  const d = ev.data ?? {};
  const who = whoShort(ev);
  const tail = who ? ` · ${who}` : "";
  const base = [
    ["Utilisateur", ev.name || "—"],
    ["Téléphone", formatPhone(ev.phone)],
    ["Date (Cameroun)", formatLocal(ev.at)],
    ["Réf. événement", ev.id],
  ];
  switch (ev.type) {
    case "signup":
      return brief(`Inscription${tail}`, base, "info");
    case "login":
      return brief(`Connexion${tail}`, base, "info");
    case "app_open":
      return brief(`Ouvert${tail}`, base, "info");
    case "message": {
      const kind = MESSAGE_KIND_FR[d.kind] ?? "Message";
      return brief(`${kind}${tail}`, base, "info");
    }
    case "payment":
      return brief(`Paiement ${amountShort(d.amountFcfa)}${tail}`, base, "money");
    case "transfer":
      return brief(`Envoi ${amountShort(d.amountFcfa)}${tail}`, base, "money");
    case "deposit": {
      const phone = requestPhone(ev);
      const tailPhone = phone ? ` · ${phone}` : "";
      return brief(`Recharge demandée ${amountF(d.amountFcfa)}${tailPhone}`, base, "alert");
    }
    case "withdrawal": {
      const phone = requestPhone(ev);
      const tailPhone = phone ? ` · ${phone}` : "";
      return brief(`Retrait demandé ${amountF(d.amountFcfa)}${tailPhone}`, base, "alert");
    }
    case "user_deleted":
      return brief(`Supprimé${tail}`, base, "alert");
    case "admin_action":
      return brief(`Admin${tail}`, base, "alert");
    default:
      return brief(String(ev.type || "Alerte"), base, "info");
  }
}

/* -------------------------------------------------------------------------- */
/* Push                                                                        */
/* -------------------------------------------------------------------------- */

const EXPO_TOKEN_RE = /^ExponentPushToken\[.+\]$/;

async function founderExpoTokens() {
  const out = [];
  for (const raw of adminConfig().pushPhones) {
    const phone = normalizeCameroonPhone(raw);
    if (!phone) continue;
    try {
      const userId = await getUserIdByPhone(phone);
      if (!userId) continue;
      const devices = await listDeviceTokens(userId);
      for (const d of devices) {
        const token = String(d.token ?? "");
        if (EXPO_TOKEN_RE.test(token)) out.push(token);
      }
    } catch {
      /* un téléphone en moins ne bloque pas les autres */
    }
  }
  return out;
}

/** Une ligne, sur l'app admin et sur les téléphones déjà connus. */
export async function sendAdminPush({ title, eventId, eventType }) {
  const line = String(title).slice(0, 80);
  const adminDevices = await listAdminDevices();
  const messages = [];
  const seen = new Set();
  const alarm = eventType === "deposit" || eventType === "withdrawal";
  const pushExpo = (token) => {
    if (!token || seen.has(token)) return;
    seen.add(token);
    const data = {
      type: "admin_alert",
      title: line,
      message: line,
      eventId: String(eventId ?? ""),
      eventType: String(eventType ?? ""),
      alarm: alarm ? "1" : "0",
      channelId: alarm ? "blyp_money_alarm" : "admin_alerts",
      sound: alarm ? "default" : "",
    };
    /** Data-only : recharge/retrait sonnent via `AdminAlertPresenter` même téléphone verrouillé. */
    messages.push({
      to: token,
      priority: "high",
      _contentAvailable: true,
      data,
    });
  };
  for (const dev of adminDevices) {
    const token = String(dev.token ?? "");
    if (EXPO_TOKEN_RE.test(token)) pushExpo(token);
  }
  for (const token of await founderExpoTokens()) pushExpo(token);
  if (!messages.length) return { skipped: "NO_DEVICES" };

  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    throw new Error(`Expo push HTTP ${res.status}`);
  }
  const json = await res.json().catch(() => null);
  const tickets = json?.data ?? [];
  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    if (
      t?.status === "error" &&
      String(t.details?.error ?? "").includes("DeviceNotRegistered") &&
      messages[i]?.to
    ) {
      await deleteAdminDeviceByToken(messages[i].to).catch(() => {});
    }
  }
  return { sent: messages.length };
}

/* -------------------------------------------------------------------------- */
/* Email                                                                       */
/* -------------------------------------------------------------------------- */

export function dashboardUrl() {
  return String(process.env.ADMIN_DASHBOARD_URL ?? "").trim();
}

export function renderEmailHtml({ heading, intro, lines = [], footer = "", accent = "#5dc705" }) {
  const rows = lines
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px;color:#6b7280;font-size:13px;white-space:nowrap">${escapeHtml(
          k,
        )}</td><td style="padding:6px 12px;color:#111827;font-size:14px;font-weight:600">${escapeHtml(
          v,
        )}</td></tr>`,
    )
    .join("");
  const url = dashboardUrl();
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<div style="background:${accent};padding:16px 20px;color:#fff;font-size:18px;font-weight:700">${escapeHtml(heading)}</div>
<div style="padding:16px 20px;color:#374151;font-size:14px">${escapeHtml(intro)}</div>
${rows ? `<table style="width:100%;border-collapse:collapse;border-top:1px solid #f3f4f6">${rows}</table>` : ""}
${url ? `<div style="padding:16px 20px"><a href="${escapeHtml(url)}" style="background:#111827;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px">Ouvrir le tableau de bord</a></div>` : ""}
<div style="padding:12px 20px;color:#9ca3af;font-size:12px">${escapeHtml(footer || "Blyp — alerte automatique. Ne transférez pas cet email.")}</div>
</div></body></html>`;
}

export function renderEmailText({ heading, intro, lines = [] }) {
  return [heading, "", intro, "", ...lines.map(([k, v]) => `${k}: ${v}`)].join("\n");
}

export async function sendAdminEmail({ subject, html, text }) {
  const cfg = adminConfig();
  if (!cfg.emails.length || !cfg.senderEmail) return { skipped: "NO_EMAIL_CONFIG" };
  /** Un envoi par adresse : si l'une est indisponible, les autres reçoivent quand même. */
  const results = await Promise.allSettled(
    cfg.emails.map((to) =>
      ses.send(
        new SendEmailCommand({
          FromEmailAddress: cfg.senderEmail,
          Destination: { ToAddresses: [to] },
          Content: {
            Simple: {
              Subject: { Data: String(subject).slice(0, 200), Charset: "UTF-8" },
              Body: {
                Html: { Data: html, Charset: "UTF-8" },
                Text: { Data: text, Charset: "UTF-8" },
              },
            },
          },
        }),
      ),
    ),
  );
  const sent = results.filter((r) => r.status === "fulfilled").length;
  if (!sent) {
    throw results.find((r) => r.status === "rejected")?.reason ?? new Error("EMAIL_FAILED");
  }
  const failed = results.length - sent;
  if (failed) console.warn("[adminNotify] email partiel", { sent, failed });
  return { sent };
}

/** Push + email selon les préférences, sans jamais lever d'exception. */
export async function notifyAdminOfEvent(item, prefs, { emailAllowed = true } = {}) {
  const d = describeEvent(item);
  const out = { push: null, email: null };
  if (prefs?.push) {
    try {
      out.push = await sendAdminPush({
        title: d.title,
        eventId: item.id,
        eventType: item.type,
      });
    } catch (err) {
      out.push = { error: String(err?.message ?? err) };
      console.warn("[adminNotify] push failed", out.push.error);
    }
  }
  if (prefs?.email && emailAllowed) {
    try {
      const moneyMail = item.type === "deposit" || item.type === "withdrawal";
      const phone = requestPhone(item).replace(/\s/g, "");
      const amount = Math.max(0, Math.round(Number(item.data?.amountFcfa) || 0));
      const subject = moneyMail
        ? `${item.type === "deposit" ? "Rch" : "Rt"}, ${phone || "—"}, ${amount}`
        : d.title;
      const body = moneyMail ? subject : d.title;
      out.email = await sendAdminEmail({
        subject,
        html: `<p style="font-family:sans-serif;font-size:16px;margin:12px">${escapeHtml(body)}</p>`,
        text: body,
      });
    } catch (err) {
      out.email = { error: String(err?.message ?? err) };
      console.warn("[adminNotify] email failed", out.email.error);
    }
  } else if (prefs?.email && !emailAllowed) {
    out.email = { skipped: "RATE_CAPPED" };
  }
  return out;
}
