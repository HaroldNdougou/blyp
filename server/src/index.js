import { PrismaClient } from "@prisma/client";
import cors from "cors";
import crypto from "crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { execSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import "./loadEnv.js";
import { deliverOtpSms, describeSmsSetup } from "./sms.js";

const prisma = new PrismaClient();
const app = express();
const PORT = Number(process.env.PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "dev-insecure";
const OTP_PEPPER = process.env.OTP_PEPPER || "pepper";

/** Délai minimum entre deux envois SMS pour un même numéro (évite abus / coûts). */
const OTP_RESEND_COOLDOWN_MS = 60_000;
const lastOtpRequestAtByPhone = new Map();

app.use(cors({ origin: true }));
app.use(express.json());

function hashOtp(phone, code) {
  return crypto
    .createHash("sha256")
    .update(`${OTP_PEPPER}|${phone}|${code}`)
    .digest("hex");
}

/** Accepte le numéro saisi après +237 (ex. 6XXXXXXXX). */
function normalizeCameroonPhone(raw) {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length < 9) return null;
  const last9 = d.slice(-9);
  if (!/^6\d{8}$/.test(last9)) return null;
  return `+237${last9}`;
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  try {
    const payload = jwt.verify(h.slice(7), JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "Session invalide" });
  }
}

app.post("/auth/request-otp", async (req, res) => {
  try {
    const phone = normalizeCameroonPhone(req.body?.phone);
    if (!phone) {
      return res
        .status(400)
        .json({ error: "Numéro invalide (9 chiffres commençant par 6)" });
    }

    const now = Date.now();
    const prev = lastOtpRequestAtByPhone.get(phone);
    if (prev != null && now - prev < OTP_RESEND_COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil(
        (OTP_RESEND_COOLDOWN_MS - (now - prev)) / 1000,
      );
      return res.status(429).json({
        error:
          "Un nouveau code ne peut être envoyé que toutes les 60 secondes. Réessayez dans un instant.",
        retryAfterSeconds,
      });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = hashOtp(phone, code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await prisma.otpChallenge.deleteMany({ where: { phone } });
    await prisma.otpChallenge.create({
      data: { phone, codeHash, expiresAt },
    });

    const sent = await deliverOtpSms(phone, code);
    if (!sent.ok) {
      await prisma.otpChallenge.deleteMany({ where: { phone } });
      lastOtpRequestAtByPhone.delete(phone);
      if (sent.reason === "sms_not_configured") {
        return res.status(503).json({
          error:
            "Envoi SMS non configuré côté serveur. Voir server/.env.example (Obit SMS, Africa’s Talking, webhook, etc.).",
        });
      }
      return res.status(502).json({
        error:
          "Impossible d’envoyer le SMS pour le moment. Réessaie dans un instant.",
      });
    }

    lastOtpRequestAtByPhone.set(phone, Date.now());
    res.json({ ok: true });
  } catch (e) {
    console.error("[auth/request-otp]", e);
    const detail =
      e instanceof Error ? e.message : typeof e === "string" ? e : undefined;
    if (process.env.NODE_ENV === "production") {
      return res.status(500).json({ error: "Impossible d’envoyer le code" });
    }
    return res.status(500).json({
      error: "Impossible d’envoyer le code",
      ...(detail ? { detail } : {}),
    });
  }
});

app.post("/auth/verify-otp", async (req, res) => {
  try {
    const phone = normalizeCameroonPhone(req.body?.phone);
    const code = String(req.body?.code ?? "").replace(/\D/g, "");
    if (!phone || code.length !== 6) {
      return res.status(400).json({ error: "Téléphone ou code invalide" });
    }
    const challenge = await prisma.otpChallenge.findFirst({
      where: { phone, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!challenge || challenge.codeHash !== hashOtp(phone, code)) {
      return res.status(400).json({ error: "Code incorrect ou expiré" });
    }
    await prisma.otpChallenge.deleteMany({ where: { phone } });
    let user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      user = await prisma.user.create({
        data: { phone, balanceFcfa: 0 },
      });
    }
    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: "30d" });
    res.json({
      token,
      user: { phone: user.phone, balanceFcfa: user.balanceFcfa },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Vérification impossible" });
  }
});

app.get("/me", authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(401).json({ error: "Utilisateur introuvable" });
  res.json({ phone: user.phone, balanceFcfa: user.balanceFcfa });
});

app.post("/wallet/deposit", authMiddleware, async (req, res) => {
  const amount = parseInt(String(req.body?.amount), 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Montant invalide" });
  }
  try {
    const { balanceFcfa, depositId } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: req.userId },
        data: { balanceFcfa: { increment: amount } },
      });
      const row = await tx.transaction.create({
        data: {
          userId: req.userId,
          type: "DEPOSIT",
          amountFcfa: amount,
          counterpartyName: "Rechargement",
          counterpartyPhone: null,
        },
      });
      return { balanceFcfa: user.balanceFcfa, depositId: row.id };
    });
    console.log("[wallet/deposit] enregistré", { userId: req.userId, amount, depositId });
    res.json({ balanceFcfa, transactionId: depositId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Dépôt impossible" });
  }
});

app.post("/payments/pay", authMiddleware, async (req, res) => {
  const amount = parseInt(String(req.body?.amount), 10);
  const recipientName = req.body?.recipientName || "Bénéficiaire";
  const recipientPhone = req.body?.recipientPhone ?? null;
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Montant invalide" });
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user || user.balanceFcfa < amount) {
    return res.status(400).json({ error: "Solde insuffisant" });
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: req.userId },
        data: { balanceFcfa: { decrement: amount } },
      });
      await tx.transaction.create({
        data: {
          userId: req.userId,
          type: "PAYMENT",
          amountFcfa: amount,
          counterpartyName: recipientName,
          counterpartyPhone: recipientPhone,
        },
      });
      return u;
    });
    res.json({ balanceFcfa: result.balanceFcfa });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Paiement impossible" });
  }
});

app.get("/transactions", authMiddleware, async (req, res) => {
  const rows = await prisma.transaction.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({
    items: rows.map((t) => ({
      id: t.id,
      type: t.type === "DEPOSIT" ? "received" : "sent",
      amountFcfa: t.amountFcfa,
      counterpartyName:
        t.counterpartyName ||
        (t.type === "DEPOSIT" ? "Rechargement" : "Paiement"),
      counterpartyPhone: t.counterpartyPhone,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});

/** Enregistre un clic avec date/heure serveur (test app → API → Railway). */
app.post("/hello", async (_req, res) => {
  try {
    const row = await prisma.helloLog.create({ data: {} });
    res.json({
      ok: true,
      id: row.id,
      createdAt: row.createdAt.toISOString(),
    });
  } catch (e) {
    console.error("[hello]", e);
    res.status(500).json({ error: "Impossible d’enregistrer" });
  }
});

app.get("/health", async (_, res) => {
  const sms = describeSmsSetup();
  let database = "skipped";
  if (process.env.DATABASE_URL?.trim()) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      database = "ok";
    } catch (e) {
      console.error("[health] database:", e);
      database = "error";
    }
  } else {
    database = "missing_url";
  }
  res.json({
    ok: true,
    database,
    sms: {
      sending: sms.sendingSms,
      provider: sms.provider,
      devOtpInLogs: Boolean(sms.devOtpInLogs),
      misconfigured: Boolean(sms.misconfigured),
    },
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Erreur serveur" });
});

/**
 * En prod : exige DATABASE_URL, applique le schéma Prisma avant tout trafic (évite User / OtpChallenge absents).
 */
async function ensureProductionDatabaseReady() {
  if (process.env.NODE_ENV !== "production") return;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error(
      "[blyp] FATAL: DATABASE_URL absent. Sur Railway : service API → Variables → référence DATABASE_URL depuis Postgres (blyp-db).",
    );
    process.exit(1);
  }
  const attempts = 8;
  const delayMs = 4000;
  for (let i = 0; i < attempts; i++) {
    try {
      execSync("npx prisma db push --skip-generate", {
        cwd: process.cwd(),
        env: { ...process.env, CI: "true" },
        stdio: "inherit",
        timeout: 120_000,
      });
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      console.log("[blyp] Postgres OK — schéma synchronisé (prisma db push).");
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[blyp] Sync DB tentative ${i + 1}/${attempts} échouée: ${msg}`);
      if (i === attempts - 1) {
        console.error(
          "[blyp] FATAL: impossible de joindre Postgres ou d’appliquer le schéma. Vérifie que le service API référence bien la variable DATABASE_URL du plugin Postgres.",
        );
        process.exit(1);
      }
      await delay(delayMs);
    }
  }
}

function logSmsStartup() {
  const sms = describeSmsSetup();
  if (sms.sendingSms) {
    const sender =
      process.env.OBIT_SMS_SENDER?.trim() ||
      process.env.AFRICASTALKING_SENDER_ID?.trim();
    console.log(
      `[blyp] SMS actif (${sms.provider})${sender ? ` — expéditeur ${sender}` : ""}`,
    );
  } else if (sms.misconfigured) {
    console.error(
      `[blyp] SMS : fournisseur ${sms.provider} demandé (SMS_PROVIDER) mais variables incomplètes — voir server/.env.example`,
    );
  } else if (sms.devOtpInLogs) {
    console.log(
      "[blyp] SMS : mode dev — OTP uniquement dans les logs (configure OBIT_SMS_* dans server/.env)",
    );
  } else {
    console.error(
      "[blyp] SMS non configuré — en production les OTP par SMS échoueront (OBIT_SMS_KEY_API + OBIT_SMS_SENDER, etc.)",
    );
  }
}

async function main() {
  await ensureProductionDatabaseReady();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Blyp API http://0.0.0.0:${PORT}`);
    logSmsStartup();
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
