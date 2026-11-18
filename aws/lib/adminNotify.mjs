import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { adminConfig } from "./adminAuth.mjs";
import { listAdminDevices, deleteAdminDeviceByToken } from "./adminDevices.mjs";

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
  text: "texte",
  voice: "vocal",
  image: "photo",
  document: "document",
};

/**
 * Description lisible d'un événement.
 * @returns {{ title: string, summary: string, lines: Array<[string,string]>, severity: "info"|"money"|"alert" }}
 */
export function describeEvent(ev) {
  const d = ev.data ?? {};
  const who = ev.name || formatPhone(ev.phone);
  const base = [
    ["Utilisateur", ev.name || "—"],
    ["Téléphone", formatPhone(ev.phone)],
    ["Date (Cameroun)", formatLocal(ev.at)],
    ["Réf. événement", ev.id],
  ];
  switch (ev.type) {
    case "signup":
      return {
        title: `Nouvelle inscription — ${who}`,
        summary: `${who} vient de créer son compte.`,
        lines: base,
        severity: "info",
      };
    case "login":
      return {
        title: `Connexion — ${who}`,
        summary: d.isNewAccount
          ? `${who} se connecte pour la première fois (inscription en cours).`
          : `${who} s'est connecté.`,
        lines: [
          ...base,
          ["Nouveau compte", d.isNewAccount ? "oui" : "non"],
          ["Ancienne session remplacée", d.replacedPreviousSession ? "oui" : "non"],
        ],
        severity: "info",
      };
    case "app_open":
      return {
        title: `Ouverture de l'app — ${who}`,
        summary: `${who} a ouvert l'application.`,
        lines: [...base, ["Appareil", d.userAgent || "—"], ["IP", d.ip || "—"]],
        severity: "info",
      };
    case "message": {
      const kind = MESSAGE_KIND_FR[d.kind] ?? d.kind ?? "message";
      const to = d.toName ? ` à ${d.toName}` : "";
      return {
        title: `Message (${kind}) — ${who}`,
        summary: `${who} a envoyé un message ${kind}${to}.`,
        lines: [
          ...base,
          ["Type", kind],
          ["Destinataire", d.toName ? `${d.toName} (${formatPhone(d.toPhone)})` : "—"],
          ["Conversation", d.conversationId || "—"],
          ["Contenu", "non stocké (confidentialité)"],
        ],
        severity: "info",
      };
    }
    case "payment":
      return {
        title: `Paiement ${fcfa(d.amountFcfa)} — ${who}`,
        summary: `${who} a payé ${fcfa(d.amountFcfa)} à ${d.commerceName || d.payeeName || "—"}.`,
        lines: [
          ...base,
          ["Montant", fcfa(d.amountFcfa)],
          ["Commerce", d.commerceName || d.payeeName || "—"],
          ["Tél. commerce", formatPhone(d.payeePhone)],
          ["Compte payé", d.payeeAccountId || "—"],
          ["Solde payeur après", d.balanceAfterFcfa != null ? fcfa(d.balanceAfterFcfa) : "—"],
          ["Transaction", d.transactionId || "—"],
          ["Référence", d.reference || "—"],
        ],
        severity: "money",
      };
    case "transfer":
      return {
        title: `Envoi ${fcfa(d.amountFcfa)} — ${who}`,
        summary: `${who} a envoyé ${fcfa(d.amountFcfa)} à ${d.payeeName || "—"}.`,
        lines: [
          ...base,
          ["Montant", fcfa(d.amountFcfa)],
          ["Bénéficiaire", d.payeeName || "—"],
          ["Tél. bénéficiaire", formatPhone(d.payeePhone)],
          ["Canal", d.via === "chat" ? "message money" : "paiement direct"],
          ["Solde après", d.balanceAfterFcfa != null ? fcfa(d.balanceAfterFcfa) : "—"],
          ["Transaction", d.transactionId || "—"],
          ["Référence", d.reference || "—"],
        ],
        severity: "money",
      };
    case "deposit":
      return {
        title: `RECHARGE ${fcfa(d.amountFcfa)} — ${who}`,
        summary: `${who} a rechargé son solde de ${fcfa(d.amountFcfa)}.`,
        lines: [
          ...base,
          ["Montant", fcfa(d.amountFcfa)],
          ["Opérateur / mode", d.provider || "—"],
          ["Réf. opérateur", d.providerRef || "—"],
          ["Transaction", d.transactionId || "—"],
          ["Référence", d.reference || "—"],
          ["Solde après", d.balanceAfterFcfa != null ? fcfa(d.balanceAfterFcfa) : "—"],
        ],
        severity: "alert",
      };
    case "withdrawal":
      return {
        title: `RETRAIT ${fcfa(d.amountFcfa)} — ${who}`,
        summary: `${who} a demandé un retrait de ${fcfa(d.amountFcfa)}.`,
        lines: [
          ...base,
          ["Montant", fcfa(d.amountFcfa)],
          ["Destination", d.destination || "—"],
          ["Opérateur / mode", d.provider || "—"],
          ["Frais", d.feeFcfa != null ? fcfa(d.feeFcfa) : "—"],
          ["Statut", d.status || "—"],
          ["Transaction", d.transactionId || "—"],
          ["Solde après", d.balanceAfterFcfa != null ? fcfa(d.balanceAfterFcfa) : "—"],
        ],
        severity: "alert",
      };
    case "user_deleted":
      return {
        title: `Compte supprimé — ${who}`,
        summary: `Le compte de ${who} a été supprimé.`,
        lines: [...base, ["Motif", d.reason || "—"], ["Solde au moment de la suppression", fcfa(d.balanceFcfa ?? 0)]],
        severity: "alert",
      };
    case "admin_action":
      return {
        title: `Action admin — ${d.action || "?"}`,
        summary: `${d.action || "Action"} sur ${d.targetLabel || who}.`,
        lines: [
          ...base,
          ["Action", d.action || "—"],
          ["Cible", d.targetLabel || "—"],
          ["Montant", d.amountFcfa != null ? fcfa(d.amountFcfa) : "—"],
          ["Motif", d.reason || "—"],
          ["IP admin", d.ip || "—"],
        ],
        severity: "alert",
      };
    default:
      return { title: `Événement ${ev.type}`, summary: ev.type, lines: base, severity: "info" };
  }
}

/* -------------------------------------------------------------------------- */
/* Push                                                                        */
/* -------------------------------------------------------------------------- */

/** Push visible vers l'app admin (pas l'app client Blyp). */
export async function sendAdminPush({ title, body, eventId, eventType }) {
  const devices = await listAdminDevices();
  if (!devices.length) return { skipped: "NO_DEVICES" };

  const messages = devices.map((dev) => ({
    to: dev.token,
    title: String(title).slice(0, 120),
    body: String(body).slice(0, 400),
    sound: "default",
    priority: "high",
    channelId: "admin_alerts",
    data: {
      type: "admin_alert",
      title: String(title).slice(0, 120),
      message: String(body).slice(0, 400),
      eventId: String(eventId ?? ""),
      eventType: String(eventType ?? ""),
      channelId: "admin_alerts",
    },
  }));
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
      devices[i]?.token
    ) {
      await deleteAdminDeviceByToken(devices[i].token).catch(() => {});
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
        body: d.summary,
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
      const mail = {
        heading: d.title,
        intro: d.summary,
        lines: d.lines,
        accent: d.severity === "alert" ? "#d97706" : d.severity === "money" ? "#2563eb" : "#5dc705",
      };
      out.email = await sendAdminEmail({
        subject: `[Blyp] ${d.title}`,
        html: renderEmailHtml(mail),
        text: renderEmailText(mail),
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
