import "./loadEnv.js";
import { spawn } from "node:child_process";
import crypto from "crypto";
import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { deliverOtpSms, describeSmsSetup } from "./sms.js";

const prisma = new PrismaClient();
const app = express();
const PORT = Number(process.env.PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "dev-insecure";
const OTP_PEPPER = process.env.OTP_PEPPER || "pepper";

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

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Impossible d’envoyer le code" });
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
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: req.userId },
        data: { balanceFcfa: { increment: amount } },
      });
      await tx.transaction.create({
        data: {
          userId: req.userId,
          type: "DEPOSIT",
          amountFcfa: amount,
          counterpartyName: "Rechargement",
          counterpartyPhone: null,
        },
      });
      return user;
    });
    res.json({ balanceFcfa: result.balanceFcfa });
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

app.get("/health", (_, res) => {
  const sms = describeSmsSetup();
  res.json({
    ok: true,
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

function runDbPushInBackground() {
  const child = spawn("npx", ["prisma", "db", "push"], {
    stdio: "inherit",
    env: process.env,
    cwd: process.cwd(),
  });
  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(`[blyp] prisma db push a échoué (code ${code}) — vérifie DATABASE_URL sur Railway`);
    } else {
      console.log("[blyp] schéma base synchronisé");
    }
  });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Blyp API http://0.0.0.0:${PORT}`);
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
  if (process.env.NODE_ENV === "production") {
    if (!process.env.DATABASE_URL) {
      console.error(
        "[blyp] DATABASE_URL manquant — ajoute la référence Postgres dans Variables Railway",
      );
    } else {
      runDbPushInBackground();
    }
  }
});
