import { PrismaClient } from "@prisma/client";
import cors from "cors";
import crypto from "crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { execSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import "./loadEnv.js";
import {
  androidOtpSmsHashHealthSnapshot,
  deliverOtpSms,
  describeSmsSetup,
} from "./sms.js";
import { hashTransactionPin, verifyTransactionPin } from "./pin.js";

const prisma = new PrismaClient();
const app = express();
const PORT = Number(process.env.PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "dev-insecure";
/** Trim : un espace en fin de ligne dans `.env` / Railway cassait tous les hash OTP. */
const OTP_PEPPER =
  String(process.env.OTP_PEPPER ?? "pepper").trim() || "pepper";
const TRANSACTION_PIN_PEPPER =
  process.env.TRANSACTION_PIN_PEPPER?.trim() || OTP_PEPPER;

/** Délai minimum entre deux envois SMS pour un même numéro (évite abus / coûts). */
const OTP_RESEND_COOLDOWN_MS = 60_000;
const lastOtpRequestAtByPhone = new Map();

/**
 * Si le 1er POST /auth/verify-otp réussit (challenge supprimé) mais la réponse réseau est perdue,
 * le client retente : sans cache on renvoie « Code incorrect ». Fenêtre courte d’idempotence.
 * (Une seule instance API ; plusieurs instances = Redis plus tard.)
 */
const OTP_VERIFY_IDEMPOTENCY_MS = 120_000;
const otpVerifySuccessCache = new Map();

function pruneOtpVerifySuccessCache() {
  const now = Date.now();
  for (const [k, v] of otpVerifySuccessCache) {
    if (now - v.at > OTP_VERIFY_IDEMPOTENCY_MS) otpVerifySuccessCache.delete(k);
  }
}

app.use(cors({ origin: true }));
app.use(express.json());

function hashOtp(phone, code) {
  return crypto
    .createHash("sha256")
    .update(`${OTP_PEPPER}|${phone}|${code}`)
    .digest("hex");
}

function otpVerifyCacheKey(phone, code) {
  return `${phone}|${hashOtp(phone, code)}`;
}

/** Accepte le numéro saisi après +237 (ex. 6XXXXXXXX). */
function normalizeCameroonPhone(raw) {
  const d = String(raw ?? "")
    .trim()
    .replace(/\D/g, "");
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

function trimStr(s) {
  return String(s ?? "").trim();
}

function getOnboardingStep(u) {
  if (!u?.transactionPinHash) return "pin";
  if (!trimStr(u.firstName) || !trimStr(u.lastName)) return "profile";
  return null;
}

function userToApi(u) {
  const onboardingStep = getOnboardingStep(u);
  return {
    phone: u.phone,
    balanceFcfa: u.balanceFcfa,
    needsOnboarding: onboardingStep != null,
    onboardingStep,
    firstName: u.firstName ?? null,
    lastName: u.lastName ?? null,
  };
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
    try {
      await prisma.otpSendLog.create({ data: { phone } });
    } catch (logErr) {
      console.error("[auth/request-otp] OtpSendLog", logErr);
    }
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

    pruneOtpVerifySuccessCache();
    const cacheKey = otpVerifyCacheKey(phone, code);
    const cached = otpVerifySuccessCache.get(cacheKey);
    if (cached && Date.now() - cached.at < OTP_VERIFY_IDEMPOTENCY_MS) {
      return res.json(cached.payload);
    }

    const challenge = await prisma.otpChallenge.findFirst({
      where: { phone, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    const expectedHash = hashOtp(phone, code);
    if (!challenge) {
      console.warn("[verify-otp] aucun challenge actif (expiré, déjà utilisé, ou mauvais numéro)");
      return res.status(400).json({ error: "Code incorrect ou expiré" });
    }
    if (challenge.codeHash !== expectedHash) {
      console.warn("[verify-otp] hash OTP incorrect (vérifier OTP_PEPPER identique partout)");
      return res.status(400).json({ error: "Code incorrect ou expiré" });
    }
    await prisma.otpChallenge.deleteMany({ where: { phone } });
    const existingBefore = await prisma.user.findUnique({ where: { phone } });
    let user = existingBefore;
    if (!user) {
      user = await prisma.user.create({
        data: { phone, balanceFcfa: 0 },
      });
    }
    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: "30d" });
    const payload = {
      token,
      user: userToApi(user),
      isNewAccount: !existingBefore,
    };
    otpVerifySuccessCache.set(cacheKey, { at: Date.now(), payload });
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Vérification impossible" });
  }
});

app.get("/me", authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(401).json({ error: "Utilisateur introuvable" });
  res.json(userToApi(user));
});

app.post("/auth/onboarding/transaction-pin", authMiddleware, async (req, res) => {
  try {
    const pin = String(req.body?.pin ?? "").replace(/\D/g, "");
    if (pin.length !== 4) {
      return res
        .status(400)
        .json({ error: "Le code PIN doit comporter 4 chiffres" });
    }
    const row = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!row) return res.status(401).json({ error: "Utilisateur introuvable" });
    if (row.transactionPinHash) {
      return res.status(400).json({ error: "Code PIN déjà défini" });
    }
    let hash;
    try {
      hash = hashTransactionPin(pin, TRANSACTION_PIN_PEPPER);
    } catch (e) {
      console.error("[onboarding/pin]", e);
      return res.status(500).json({ error: "Configuration serveur (PIN) invalide" });
    }
    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: { transactionPinHash: hash },
    });
    res.json({ user: userToApi(updated) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Enregistrement du PIN impossible" });
  }
});

app.post("/auth/onboarding/profile", authMiddleware, async (req, res) => {
  try {
    const firstName = trimStr(req.body?.firstName);
    const lastName = trimStr(req.body?.lastName);
    if (firstName.length < 2 || firstName.length > 80) {
      return res
        .status(400)
        .json({ error: "Prénom invalide (2 à 80 caractères)" });
    }
    if (lastName.length < 2 || lastName.length > 80) {
      return res.status(400).json({ error: "Nom invalide (2 à 80 caractères)" });
    }
    const nameRe = /^[a-zA-ZÀ-ÿ\s'-]+$/;
    if (!nameRe.test(firstName) || !nameRe.test(lastName)) {
      return res.status(400).json({
        error: "Prénom ou nom : lettres, espaces, tirets et apostrophes uniquement",
      });
    }
    const row = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!row?.transactionPinHash) {
      return res
        .status(400)
        .json({ error: "Définissez d’abord votre code PIN de transaction" });
    }
    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: { firstName, lastName },
    });
    res.json({ user: userToApi(updated) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Enregistrement du profil impossible" });
  }
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
  const transactionPin = String(req.body?.transactionPin ?? "").replace(
    /\D/g,
    "",
  );
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Montant invalide" });
  }
  if (transactionPin.length !== 4) {
    return res
      .status(400)
      .json({ error: "Code PIN de transaction requis (4 chiffres)" });
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user || user.balanceFcfa < amount) {
    return res.status(400).json({ error: "Solde insuffisant" });
  }
  if (!user.transactionPinHash) {
    return res.status(403).json({
      error: "Complétez votre inscription (code PIN) pour payer",
    });
  }
  if (
    !verifyTransactionPin(
      transactionPin,
      user.transactionPinHash,
      TRANSACTION_PIN_PEPPER,
    )
  ) {
    return res.status(400).json({ error: "Code PIN incorrect" });
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

/** Si `db push` n’a pas créé la table (image ancienne, etc.), on la crée au vol (aligné sur schema.prisma). */
async function ensureHelloLogTableSql() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "HelloLog" (
      "id" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "HelloLog_pkey" PRIMARY KEY ("id")
    );
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "HelloLog_createdAt_idx" ON "HelloLog"("createdAt");`,
  );
}

async function ensureOtpSendLogTableSql() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "OtpSendLog" (
      "id" TEXT NOT NULL,
      "phone" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "OtpSendLog_pkey" PRIMARY KEY ("id")
    );
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "OtpSendLog_phone_createdAt_idx" ON "OtpSendLog"("phone", "createdAt");`,
  );
}

function isHelloLogTableMissingError(e) {
  const code = e?.code;
  if (code === "P2021") return true;
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /HelloLog|helloLog/i.test(msg) && /does not exist|n'existe pas|relation/i.test(msg);
}

/** Enregistre un clic avec date/heure serveur (test app → API → Railway). */
app.post("/hello", async (_req, res) => {
  const insertRow = () => prisma.helloLog.create({ data: {} });
  try {
    const row = await insertRow();
    res.json({
      ok: true,
      id: row.id,
      createdAt: row.createdAt.toISOString(),
    });
  } catch (e) {
    if (isHelloLogTableMissingError(e)) {
      try {
        await ensureHelloLogTableSql();
        const row = await insertRow();
        res.json({
          ok: true,
          id: row.id,
          createdAt: row.createdAt.toISOString(),
        });
      } catch (e2) {
        console.error("[hello] après ensureHelloLogTableSql", e2);
        res.status(500).json({
          error: "Impossible d’enregistrer",
          detail: e2 instanceof Error ? e2.message : String(e2),
        });
      }
      return;
    }
    console.error("[hello]", e);
    res.status(500).json({
      error: "Impossible d’enregistrer",
      detail: e instanceof Error ? e.message : String(e),
    });
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
      androidOtpHash: androidOtpSmsHashHealthSnapshot(),
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
      await ensureHelloLogTableSql();
      await ensureOtpSendLogTableSql();
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
