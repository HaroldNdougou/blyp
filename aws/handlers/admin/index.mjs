import { randomBytes } from "node:crypto";
import {
  adjustBalance,
  createUser,
  deleteUser,
  getUserDetail,
  listUsers,
  resolveUserId,
  setPayBlocked,
} from "../../lib/adminActions.mjs";
import {
  deleteAdminDeviceByToken,
  upsertAdminDevice,
} from "../../lib/adminDevices.mjs";
import {
  SESSION_TTL_SEC,
  ELEVATION_TTL_SEC,
  adminConfig,
  checkCredentials,
  clearSessionCookie,
  clientIp,
  headerOf,
  ipAllowed,
  isAdminConfigured,
  requireSession,
  sessionCookie,
  signElevation,
  signSession,
  verifyElevation,
} from "../../lib/adminAuth.mjs";
import {
  cohortTable,
  computeFloat,
  eventsToCsvRows,
  monthlySeries,
  overview,
  toCsv,
} from "../../lib/adminMetrics.mjs";
import { describeEvent } from "../../lib/adminNotify.mjs";
import { runRecaps } from "../../lib/adminRecap.mjs";
import {
  eventsForRange,
  getSettings,
  listAudit,
  listEvents,
  saveSettings,
  writeAudit,
} from "../../lib/adminStore.mjs";
import { dayKey, shiftDay } from "../../lib/adminTime.mjs";
import { renderDashboard } from "./dashboard.mjs";
import { renderInvestorReport } from "./report.mjs";

/**
 * API + site du tableau de bord fondateur. Une seule Lambda, une seule URL : /admin
 *
 * Défense en profondeur :
 *  1. mot de passe + TOTP (verrouillage après 5 échecs) ;
 *  2. session = cookie HttpOnly/Secure/SameSite=Strict + en-tête anti-CSRF ;
 *  3. actions d'argent / suppression : « élévation » 5 min (re-saisie mot de passe + nouveau code) ;
 *  4. journal d'audit append-only de chaque action ;
 *  5. liste blanche d'IP optionnelle ; aucune donnée sensible (PIN, OTP, contenu des messages) exposée.
 */

const SECURITY_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Robots-Tag": "noindex, nofollow",
};

function reply(statusCode, body, extra = {}, cookies = null) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...extra },
    body: JSON.stringify(body),
    ...(cookies ? { cookies } : {}),
  };
}

function html(statusCode, markup, nonce) {
  return {
    statusCode,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...SECURITY_HEADERS,
      "Content-Security-Policy": [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        `style-src 'nonce-${nonce}'`,
        "connect-src 'self'",
        "img-src 'self' data:",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    },
    body: markup,
  };
}

function csv(filename, content) {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      ...SECURITY_HEADERS,
    },
    body: content,
  };
}

function parseBody(event) {
  if (!event?.body) return {};
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    if (raw.length > 20_000) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** `/dev/admin/api/x` → `/api/x` ; `/dev/admin` → ``. */
function adminPath(event) {
  let path = event?.rawPath ?? "/";
  const stage = event?.requestContext?.stage;
  if (stage && stage !== "$default" && path.startsWith(`/${stage}/`)) {
    path = path.slice(stage.length + 1);
  }
  if (path === "/admin" || path === "/admin/") return "";
  return path.startsWith("/admin/") ? path.slice("/admin".length) : null;
}

const ERROR_FR = {
  AMOUNT_INVALID: "Montant invalide (entier entre 1 et 10 000 000 FCFA).",
  DIRECTION_INVALID: "Sens invalide.",
  REASON_REQUIRED: "Un motif (3 caractères minimum) est obligatoire.",
  IDEMPOTENCY_REQUIRED: "Clé d'opération manquante — rechargez la page.",
  USER_NOT_FOUND: "Utilisateur introuvable.",
  INSUFFICIENT_BALANCE: "Solde insuffisant pour ce débit.",
  PHONE_INVALID: "Numéro de téléphone invalide (format camerounais).",
  NAME_REQUIRED: "Prénom et nom obligatoires.",
  USER_EXISTS: "Ce numéro a déjà un compte.",
  CONFIRM_PHONE_MISMATCH: "Le numéro de confirmation ne correspond pas.",
  HAS_COMMERCES: "Ce compte possède des commerces : suppression refusée par sécurité.",
  BALANCE_NOT_ZERO: "Le solde n'est pas nul : cochez « abandonner le solde » pour confirmer.",
};

function actionError(code, extra = {}) {
  return reply(code === "USER_NOT_FOUND" ? 404 : 400, {
    error: ERROR_FR[code] ?? code,
    code,
    ...extra,
  });
}

function validDay(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : null;
}

function testDateFor(kind, now = Date.now()) {
  const today = dayKey(now);
  if (kind === "weekly") {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    return shiftDay(today, -((dow + 6) % 7));
  }
  if (kind === "monthly") return `${today.slice(0, 7)}-01`;
  return today;
}

export async function handler(event) {
  const method = event?.requestContext?.http?.method ?? "GET";
  const sub = adminPath(event);
  if (sub === null) return reply(404, { error: "Introuvable" });

  /** Lien « Ouvrir le tableau de bord » des emails envoyés depuis cette Lambda (récap de test). */
  const host = event?.requestContext?.domainName;
  const stage = event?.requestContext?.stage;
  if (!process.env.ADMIN_DASHBOARD_URL && host && stage && stage !== "$default") {
    process.env.ADMIN_DASHBOARD_URL = `https://${host}/${stage}/admin`;
  }

  const cfg = adminConfig();
  const ip = clientIp(event);

  if (!ipAllowed(event, cfg)) return reply(403, { error: "Accès refusé" });

  /* ----- Page web ----- */
  if (method === "GET" && sub === "") {
    const nonce = randomBytes(16).toString("base64");
    return html(200, renderDashboard({ nonce, configured: isAdminConfigured(cfg) }), nonce);
  }

  if (!sub.startsWith("/api/") && sub !== "/report") {
    return reply(404, { error: "Introuvable" });
  }

  if (!isAdminConfigured(cfg)) {
    return reply(503, { error: "Tableau de bord non configuré (voir docs/ADMIN-DASHBOARD.md)." });
  }

  /* ----- Connexion / déconnexion (sans session) ----- */
  if (method === "POST" && sub === "/api/login") {
    const body = parseBody(event);
    if (!body) return reply(400, { error: "Requête invalide" });
    if (headerOf(event, "x-requested-with") !== "blyp-admin") {
      return reply(400, { error: "Requête invalide" });
    }
    const res = await checkCredentials({
      email: body.email,
      password: body.password,
      totp: body.totp,
      purpose: "login",
    });
    if (!res.ok) {
      await writeAudit({ admin: String(body.email ?? "").slice(0, 80), action: "login_failed", result: res.reason, ip });
      if (res.reason === "LOCKED") {
        return reply(429, { error: "Trop d'essais. Réessayez plus tard.", retryAfterSec: res.retryAfterSec });
      }
      return reply(401, { error: "Identifiants ou code invalides." });
    }
    const token = await signSession(cfg, res.email);
    await writeAudit({ admin: res.email, action: "login", result: "ok", ip });
    return reply(200, { ok: true, token, expiresInSec: SESSION_TTL_SEC }, {}, [sessionCookie(token)]);
  }

  if (method === "POST" && sub === "/api/logout") {
    return reply(200, { ok: true }, {}, [clearSessionCookie()]);
  }

  /* ----- Tout le reste exige une session ----- */
  const session = await requireSession(event, { csrf: method !== "GET" });
  if (!session) {
    if (sub === "/report") {
      return { statusCode: 302, headers: { Location: "../admin", ...SECURITY_HEADERS }, body: "" };
    }
    return reply(401, { error: "Session expirée", code: "SESSION_REQUIRED" });
  }
  const admin = String(session.sub ?? cfg.email);

  /** Actions sensibles : jeton d'élévation valide obligatoire. */
  const requireElevation = async () => {
    const token = headerOf(event, "x-admin-elevation");
    const ok = token ? await verifyElevation(token, cfg) : null;
    return Boolean(ok);
  };
  const ELEVATION_ERROR = reply(403, {
    error: "Confirmation de sécurité requise (mot de passe + code).",
    code: "ELEVATION_REQUIRED",
  });

  if (method === "GET" && sub === "/report") {
    const nonce = randomBytes(16).toString("base64");
    const [ov, monthly, cohorts] = await Promise.all([overview(), monthlySeries(12), cohortTable(60)]);
    return html(200, renderInvestorReport({ nonce, overview: ov, monthly, cohorts }), nonce);
  }

  /* ----- Lecture ----- */
  if (method === "GET" && sub === "/api/me") {
    return reply(200, { admin, expiresInSec: SESSION_TTL_SEC, elevationTtlSec: ELEVATION_TTL_SEC });
  }

  if (method === "GET" && sub === "/api/overview") {
    return reply(200, await overview());
  }

  if (method === "GET" && sub === "/api/events") {
    const qs = event.queryStringParameters ?? {};
    const since = /^\d{13}#[0-9a-f-]{8,}$/i.test(String(qs.since ?? "")) ? qs.since : null;
    const types = qs.types ? String(qs.types).split(",").filter(Boolean) : null;
    const data = await listEvents({ since, limit: Number(qs.limit) || 100 });
    const filtered = types ? data.items.filter((e) => types.includes(e.type)) : data.items;
    const items = filtered.map((e) => {
      const d = describeEvent(e);
      return {
        id: e.id,
        key: e.key,
        type: e.type,
        at: e.at,
        userId: e.userId,
        name: e.name,
        phone: e.phone,
        title: d.title,
        summary: d.summary,
        lines: d.lines,
        severity: d.severity,
      };
    });
    return reply(200, { items, cursor: data.cursor });
  }

  if (method === "GET" && sub === "/api/users") {
    const q = String(event.queryStringParameters?.q ?? "").slice(0, 80);
    return reply(200, await listUsers({ query: q, limit: 100 }));
  }

  const userMatch = sub.match(/^\/api\/users\/([^/]+)(?:\/(balance|block|delete))?$/);
  if (userMatch && method === "GET" && !userMatch[2]) {
    const id = await resolveUserId(decodeURIComponent(userMatch[1]));
    if (!id) return actionError("USER_NOT_FOUND");
    const detail = await getUserDetail(id);
    return detail ? reply(200, detail) : actionError("USER_NOT_FOUND");
  }

  if (method === "GET" && sub === "/api/settings") return reply(200, await getSettings());

  if (method === "GET" && sub === "/api/audit") {
    return reply(200, { items: await listAudit(14) });
  }

  if (method === "GET" && sub === "/api/investor") {
    const [ov, monthly, cohorts] = await Promise.all([overview(), monthlySeries(12), cohortTable(60)]);
    return reply(200, { overview: ov, monthly, cohorts });
  }

  /* ----- Exports CSV ----- */
  if (method === "GET" && sub.startsWith("/api/export/")) {
    const qs = event.queryStringParameters ?? {};
    const stamp = dayKey(Date.now());
    let res = null;
    if (sub === "/api/export/events.csv") {
      const to = validDay(qs.to) ?? stamp;
      const from = validDay(qs.from) ?? shiftDay(to, -6);
      if (from > to || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 92) {
        return reply(400, { error: "Période invalide (92 jours maximum)." });
      }
      const types = qs.types ? String(qs.types).split(",").filter(Boolean) : null;
      const events = await eventsForRange(from, to, { types });
      res = csv(`blyp-evenements-${from}_${to}.csv`, toCsv(eventsToCsvRows(events)));
    } else if (sub === "/api/export/investor.csv") {
      res = csv(`blyp-indicateurs-mensuels-${stamp}.csv`, toCsv(await monthlySeries(24)));
    } else if (sub === "/api/export/cohorts.csv") {
      res = csv(`blyp-cohortes-${stamp}.csv`, toCsv(await cohortTable(90)));
    } else if (sub === "/api/export/users.csv") {
      const { users } = await listUsers({ limit: 500 });
      res = csv(
        `blyp-utilisateurs-${stamp}.csv`,
        toCsv(
          users.map((u) => ({
            id: u.userId,
            compte: u.accountId,
            prenom: u.firstName,
            nom: u.lastName,
            telephone: u.phone,
            inscription: u.createdAt,
            solde_fcfa: u.balanceFcfa,
            commercant: u.isMerchant ? "oui" : "non",
            kyc: u.kycStatus,
            paiements_bloques: u.payBlocked ? "oui" : "non",
          })),
        ),
      );
    } else if (sub === "/api/export/audit.csv") {
      const items = await listAudit(90);
      res = csv(`blyp-audit-${stamp}.csv`, toCsv(items));
    }
    if (res) {
      await writeAudit({ admin, action: "export", target: sub.replace("/api/export/", ""), ip });
      return res;
    }
  }

  /* ----- Écriture : session + CSRF déjà vérifiés ----- */
  if (method === "POST" && sub === "/api/device") {
    const body = parseBody(event);
    if (!body) return reply(400, { error: "Requête invalide" });
    const res = await upsertAdminDevice({
      token: body.token,
      platform: body.platform,
      deviceId: body.deviceId,
      adminEmail: admin,
    });
    if (res.error) return reply(400, { error: "Jeton invalide" });
    await writeAudit({ admin, action: "device_register", result: "ok", ip });
    return reply(200, { ok: true });
  }

  if (method === "DELETE" && sub === "/api/device") {
    const body = parseBody(event) || {};
    await deleteAdminDeviceByToken(body.token);
    await writeAudit({ admin, action: "device_unregister", result: "ok", ip });
    return reply(200, { ok: true });
  }

  if (method === "POST" && sub === "/api/elevate") {
    const body = parseBody(event);
    if (!body) return reply(400, { error: "Requête invalide" });
    const res = await checkCredentials({
      password: body.password,
      totp: body.totp,
      purpose: "elevation",
    });
    if (!res.ok) {
      await writeAudit({ admin, action: "elevation_failed", result: res.reason, ip });
      if (res.reason === "LOCKED") {
        return reply(429, { error: "Trop d'essais. Réessayez plus tard.", retryAfterSec: res.retryAfterSec });
      }
      return reply(401, { error: "Mot de passe ou code invalide." });
    }
    await writeAudit({ admin, action: "elevation", result: "ok", ip });
    return reply(200, { elevation: await signElevation(cfg, admin), expiresInSec: ELEVATION_TTL_SEC });
  }

  if (method === "PUT" && sub === "/api/settings") {
    const body = parseBody(event);
    if (!body) return reply(400, { error: "Requête invalide" });
    const saved = await saveSettings(body);
    await writeAudit({ admin, action: "settings_update", params: saved, ip });
    return reply(200, saved);
  }

  if (method === "POST" && sub === "/api/float") {
    return reply(200, await computeFloat());
  }

  if (method === "POST" && sub === "/api/recap") {
    const body = parseBody(event) ?? {};
    const kind = ["daily", "weekly", "monthly"].includes(body.kind) ? body.kind : "daily";
    const results = await runRecaps({ force: true, only: kind, date: testDateFor(kind) });
    await writeAudit({ admin, action: "recap_test", params: { kind }, ip });
    return reply(200, { ok: true, results });
  }

  if (method === "POST" && sub === "/api/users") {
    if (!(await requireElevation())) return ELEVATION_ERROR;
    const body = parseBody(event);
    if (!body) return reply(400, { error: "Requête invalide" });
    const res = await createUser({
      phone: body.phone,
      firstName: body.firstName,
      lastName: body.lastName,
      admin,
      ip,
    });
    await writeAudit({
      admin,
      action: "user_create",
      target: res.userId ?? null,
      params: { phone: body.phone, firstName: body.firstName, lastName: body.lastName },
      result: res.error ?? "ok",
      ip,
    });
    return res.error ? actionError(res.error) : reply(200, res);
  }

  if (userMatch && method === "POST" && userMatch[2]) {
    if (!(await requireElevation())) return ELEVATION_ERROR;
    const body = parseBody(event);
    if (!body) return reply(400, { error: "Requête invalide" });
    const userId = await resolveUserId(decodeURIComponent(userMatch[1]));
    if (!userId) return actionError("USER_NOT_FOUND");

    if (userMatch[2] === "balance") {
      const res = await adjustBalance({
        userId,
        direction: body.direction,
        amountFcfa: body.amountFcfa,
        reason: body.reason,
        idempotencyKey: body.idempotencyKey,
        admin,
        ip,
      });
      await writeAudit({
        admin,
        action: body.direction === "debit" ? "balance_debit" : "balance_credit",
        target: userId,
        params: { amountFcfa: body.amountFcfa, reason: body.reason, idempotencyKey: body.idempotencyKey },
        result: res.error ?? (res.reused ? "ok_reused" : "ok"),
        ip,
      });
      return res.error ? actionError(res.error) : reply(200, res);
    }

    if (userMatch[2] === "block") {
      const res = await setPayBlocked({
        userId,
        blocked: body.blocked === true,
        reason: body.reason,
        admin,
        ip,
      });
      await writeAudit({
        admin,
        action: body.blocked === true ? "pay_block" : "pay_unblock",
        target: userId,
        params: { reason: body.reason },
        result: res.error ?? "ok",
        ip,
      });
      return res.error ? actionError(res.error) : reply(200, res);
    }

    if (userMatch[2] === "delete") {
      const res = await deleteUser({
        userId,
        confirmPhone: body.confirmPhone,
        forfeitBalance: body.forfeitBalance === true,
        reason: body.reason,
        admin,
        ip,
      });
      await writeAudit({
        admin,
        action: "user_delete",
        target: userId,
        params: { reason: body.reason, forfeitBalance: body.forfeitBalance === true },
        result: res.error ?? "ok",
        ip,
      });
      return res.error ? actionError(res.error, res) : reply(200, res);
    }
  }

  return reply(404, { error: "Introuvable" });
}
