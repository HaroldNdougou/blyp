import crypto from "crypto";
import { Prisma } from "@prisma/client";
import {
  getPawapayConfig,
  pawapayGetDepositStatus,
  pawapayInitiateDeposit,
  digitsForPawapayPayer,
  inferCameroonMomoProvider,
  normalizeMmProvider,
} from "./pawapayClient.js";

const DEPOSIT_MODE = (process.env.DEPOSIT_MODE || "sync").toLowerCase();
const DEPOSIT_MIN_FCFA = Math.max(
  1,
  parseInt(String(process.env.DEPOSIT_MIN_FCFA ?? "1"), 10) || 1,
);
const DEPOSIT_MAX_FCFA = Math.min(
  10_000_000,
  parseInt(String(process.env.DEPOSIT_MAX_FCFA ?? "500000"), 10) || 500_000,
);
const PAWAPAY_WEBHOOK_SECRET = (process.env.PAWAPAY_WEBHOOK_SECRET || "").trim();
const PAWAPAY_WEBHOOK_VERIFY = (
  process.env.PAWAPAY_WEBHOOK_VERIFY || "none"
).toLowerCase();
const IDEMPOTENCY_KEY_MAX = 128;

export function isAsyncDepositMode() {
  return DEPOSIT_MODE === "async";
}

export function depositLimits() {
  return { min: DEPOSIT_MIN_FCFA, max: DEPOSIT_MAX_FCFA };
}

function trimIdempotencyKey(h) {
  const s = String(h ?? "").trim();
  if (!s || s.length > IDEMPOTENCY_KEY_MAX) return null;
  return s;
}

function hmacSha256Hex(secret, buf) {
  return crypto.createHmac("sha256", secret).update(buf).digest("hex");
}

function timingSafeEqualHex(a, b) {
  try {
    const ba = Buffer.from(String(a).trim(), "hex");
    const bb = Buffer.from(String(b).trim(), "hex");
    if (ba.length !== bb.length || ba.length === 0) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

async function finalizeCompletedByPawapayDepositId(prisma, pawapayDepositId) {
  await prisma.$transaction(
    async (tx) => {
      const intent = await tx.depositIntent.findUnique({
        where: { pawapayDepositId },
      });
      if (!intent || intent.status !== "PENDING_PROVIDER") return;
      const row = await tx.transaction.create({
        data: {
          userId: intent.userId,
          type: "DEPOSIT",
          amountFcfa: intent.amountFcfa,
          counterpartyName: "Rechargement",
          counterpartyPhone: null,
        },
      });
      await tx.user.update({
        where: { id: intent.userId },
        data: { balanceFcfa: { increment: intent.amountFcfa } },
      });
      await tx.depositIntent.update({
        where: { id: intent.id },
        data: {
          status: "COMPLETED",
          ledgerTransactionId: row.id,
          providerRef: `pawapay:${pawapayDepositId}`,
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 15000,
    },
  );
}

async function applyFailedByPawapayDepositId(prisma, pawapayDepositId, reason) {
  await prisma.depositIntent.updateMany({
    where: { pawapayDepositId, status: "PENDING_PROVIDER" },
    data: {
      status: "FAILED",
      failureReason: String(reason || "Échec du dépôt").slice(0, 500),
    },
  });
}

async function syncRemotePawapayStatusToIntent(prisma, intent) {
  if (!intent.pawapayDepositId || !getPawapayConfig().configured) {
    return intent;
  }
  const { httpStatus, json, error } = await pawapayGetDepositStatus(
    intent.pawapayDepositId,
  );
  if (error || httpStatus === 0) return intent;

  const topStatus = String(json?.status || "").toUpperCase();
  const dataStatus = String(json?.data?.status || "").toUpperCase();

  if (topStatus === "FOUND") {
    if (dataStatus === "COMPLETED") {
      await finalizeCompletedByPawapayDepositId(
        prisma,
        intent.pawapayDepositId,
      );
    } else if (dataStatus === "FAILED") {
      const fr = json?.data?.failureReason;
      const msg =
        fr?.failureMessage || fr?.failureCode || "Dépôt refusé ou échoué";
      await applyFailedByPawapayDepositId(
        prisma,
        intent.pawapayDepositId,
        msg,
      );
    }
  }

  return prisma.depositIntent.findUnique({ where: { id: intent.id } });
}

export function createWalletDepositHandlers(
  prisma,
  verifyTransactionPin,
  TRANSACTION_PIN_PEPPER,
) {
  async function respondFromExistingIntent(intent, res) {
    if (intent.status === "COMPLETED") {
      const user = await prisma.user.findUnique({
        where: { id: intent.userId },
        select: { balanceFcfa: true },
      });
      return res.status(200).json({
        status: "completed",
        balanceFcfa: user?.balanceFcfa ?? 0,
        transactionId: intent.ledgerTransactionId,
        depositIntentId: intent.id,
      });
    }
    if (intent.status === "PENDING_PROVIDER") {
      return res.status(200).json({
        status: "pending_provider",
        depositIntentId: intent.id,
        message:
          "Validez le paiement sur votre compte Mobile Money. Le solde se mettra à jour automatiquement.",
      });
    }
    return res.status(409).json({
      error:
        "Ce rechargement a échoué. Changez le montant ou réessayez plus tard.",
      depositIntentId: intent.id,
      status: "failed",
    });
  }

  async function postWalletDeposit(req, res) {
    const amount = parseInt(String(req.body?.amount), 10);
    const transactionPin = String(req.body?.transactionPin ?? "").replace(
      /\D/g,
      "",
    );
    const idempotencyKey = trimIdempotencyKey(req.headers["idempotency-key"]);
    const payerPhoneOverride = req.body?.payerPhone;
    const mmProviderRaw = req.body?.mmProvider;

    if (
      !Number.isFinite(amount) ||
      amount < DEPOSIT_MIN_FCFA ||
      amount > DEPOSIT_MAX_FCFA
    ) {
      return res.status(400).json({
        error: `Montant invalide (${DEPOSIT_MIN_FCFA}–${DEPOSIT_MAX_FCFA} FCFA)`,
      });
    }
    if (transactionPin.length !== 4) {
      return res
        .status(400)
        .json({ error: "Code PIN de transaction requis (4 chiffres)" });
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user?.transactionPinHash) {
      return res.status(403).json({
        error: "Définissez d’abord votre code PIN dans l’inscription",
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

    if (idempotencyKey) {
      const existing = await prisma.depositIntent.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: req.userId,
            idempotencyKey,
          },
        },
      });
      if (existing) return respondFromExistingIntent(existing, res);
    }

    try {
      if (!isAsyncDepositMode()) {
        const out = await prisma.$transaction(async (tx) => {
          const row = await tx.transaction.create({
            data: {
              userId: req.userId,
              type: "DEPOSIT",
              amountFcfa: amount,
              counterpartyName: "Rechargement",
              counterpartyPhone: null,
            },
          });
          const u = await tx.user.update({
            where: { id: req.userId },
            data: { balanceFcfa: { increment: amount } },
          });
          const intent = await tx.depositIntent.create({
            data: {
              userId: req.userId,
              amountFcfa: amount,
              status: "COMPLETED",
              idempotencyKey: idempotencyKey ?? undefined,
              ledgerTransactionId: row.id,
              providerRef: "sync:internal",
            },
          });
          return {
            balanceFcfa: u.balanceFcfa,
            transactionId: row.id,
            depositIntentId: intent.id,
          };
        });
        console.log("[wallet/deposit] sync OK", {
          userId: req.userId,
          amount,
          depositIntentId: out.depositIntentId,
        });
        return res.status(200).json({
          status: "completed",
          balanceFcfa: out.balanceFcfa,
          transactionId: out.transactionId,
          depositIntentId: out.depositIntentId,
        });
      }

      if (!getPawapayConfig().configured) {
        return res.status(503).json({
          error:
            "PawaPay non configuré : définissez PAWAPAY_API_TOKEN (sandbox ou prod) sur le serveur.",
        });
      }

      const phoneDigits = digitsForPawapayPayer(user.phone, payerPhoneOverride);
      if (!phoneDigits) {
        return res.status(400).json({
          error:
            "Numéro Mobile Money invalide. Utilisez 9 chiffres (6XXXXXXXX) ou 237…",
        });
      }
      const provider =
        normalizeMmProvider(mmProviderRaw) ||
        inferCameroonMomoProvider(phoneDigits);

      const pawapayDepositId = crypto.randomUUID();
      const intent = await prisma.depositIntent.create({
        data: {
          userId: req.userId,
          amountFcfa: amount,
          status: "PENDING_PROVIDER",
          idempotencyKey: idempotencyKey ?? undefined,
          pawapayDepositId,
          providerRef: "pawapay:init",
        },
      });

      const { currency } = getPawapayConfig();
      const pawa = await pawapayInitiateDeposit({
        depositId: pawapayDepositId,
        amountFcfa: amount,
        currency,
        phoneDigits,
        provider,
        clientReferenceId: intent.id,
      });

      if (pawa.error || pawa.httpStatus === 0) {
        await prisma.depositIntent.update({
          where: { id: intent.id },
          data: {
            status: "FAILED",
            failureReason: `Réseau PawaPay : ${pawa.error || "erreur"}`,
            providerRef: "pawapay:network_error",
          },
        });
        return res.status(503).json({
          error:
            pawa.error ||
            "Impossible de joindre PawaPay. Réessayez dans un instant.",
          depositIntentId: intent.id,
        });
      }

      const st = String(pawa.json?.status || "").toUpperCase();
      if (st === "REJECTED") {
        const fr = pawa.json?.failureReason;
        const msg =
          fr?.failureMessage || fr?.failureCode || "Dépôt refusé par PawaPay";
        await prisma.depositIntent.update({
          where: { id: intent.id },
          data: {
            status: "FAILED",
            failureReason: msg.slice(0, 500),
            providerRef: "pawapay:rejected",
          },
        });
        return res.status(400).json({
          error: msg,
          depositIntentId: intent.id,
        });
      }

      if (st === "ACCEPTED" || st === "DUPLICATE_IGNORED") {
        await prisma.depositIntent.update({
          where: { id: intent.id },
          data: { providerRef: `pawapay:${st}` },
        });
        console.log("[wallet/deposit] PawaPay OK", {
          userId: req.userId,
          amount,
          depositIntentId: intent.id,
          pawapayDepositId,
          initiationStatus: st,
        });
        return res.status(202).json({
          status: "pending_provider",
          depositIntentId: intent.id,
          pawapayDepositId,
          message:
            "Validez le paiement sur votre téléphone (Mobile Money). Sandbox : voir les numéros de test sur docs.pawapay.io.",
        });
      }

      await prisma.depositIntent.update({
        where: { id: intent.id },
        data: {
          status: "FAILED",
          failureReason: `Réponse PawaPay inattendue : ${st || "?"}`,
          providerRef: "pawapay:unexpected",
        },
      });
      return res.status(502).json({
        error: "Réponse PawaPay inattendue après initiation.",
        depositIntentId: intent.id,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002" &&
        idempotencyKey
      ) {
        const raced = await prisma.depositIntent.findUnique({
          where: {
            userId_idempotencyKey: {
              userId: req.userId,
              idempotencyKey,
            },
          },
        });
        if (raced) return respondFromExistingIntent(raced, res);
      }
      console.error("[wallet/deposit]", e);
      return res.status(500).json({ error: "Dépôt impossible" });
    }
  }

  async function getWalletDepositStatus(req, res) {
    const id = trimStrParam(req.params?.id);
    if (!id) return res.status(400).json({ error: "Identifiant invalide" });
    let intent = await prisma.depositIntent.findFirst({
      where: { id, userId: req.userId },
    });
    if (!intent) return res.status(404).json({ error: "Dépôt introuvable" });

    if (intent.status === "PENDING_PROVIDER") {
      intent = await syncRemotePawapayStatusToIntent(prisma, intent);
      if (!intent) {
        return res.status(404).json({ error: "Dépôt introuvable" });
      }
    }

    if (intent.status === "COMPLETED") {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { balanceFcfa: true },
      });
      return res.json({
        status: "completed",
        depositIntentId: intent.id,
        amountFcfa: intent.amountFcfa,
        balanceFcfa: user?.balanceFcfa ?? 0,
        transactionId: intent.ledgerTransactionId,
      });
    }
    if (intent.status === "PENDING_PROVIDER") {
      return res.json({
        status: "pending_provider",
        depositIntentId: intent.id,
        amountFcfa: intent.amountFcfa,
      });
    }
    return res.json({
      status: "failed",
      depositIntentId: intent.id,
      amountFcfa: intent.amountFcfa,
      failureReason: intent.failureReason,
    });
  }

  async function postPawapayDepositWebhook(req, res) {
    if (!isAsyncDepositMode()) {
      return res.status(404).json({ error: "Mode async désactivé" });
    }

    const raw = req.body;
    if (!Buffer.isBuffer(raw) || raw.length === 0) {
      return res.status(400).json({ error: "Corps vide" });
    }

    if (PAWAPAY_WEBHOOK_VERIFY === "hmac") {
      if (!PAWAPAY_WEBHOOK_SECRET) {
        return res.status(503).json({ error: "PAWAPAY_WEBHOOK_SECRET manquant" });
      }
      const sig = req.headers["x-pawapay-signature"];
      const expected = hmacSha256Hex(PAWAPAY_WEBHOOK_SECRET, raw);
      if (!timingSafeEqualHex(expected, sig)) {
        return res.status(401).json({ error: "Signature invalide" });
      }
    } else if (PAWAPAY_WEBHOOK_VERIFY !== "none") {
      return res.status(500).json({
        error:
          "PAWAPAY_WEBHOOK_VERIFY doit être « none » (callbacks PawaPay directs) ou « hmac » (tests manuels).",
      });
    }

    let body;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "JSON invalide" });
    }

    const depositId = trimStrParam(body?.depositId);
    const status = String(body?.status || "").toUpperCase();
    if (!depositId) {
      return res.status(400).json({ error: "depositId requis" });
    }

    if (status === "PROCESSING") {
      return res.json({ ok: true });
    }

    if (status === "FAILED") {
      const fr = body?.failureReason;
      const msg =
        fr?.failureMessage || fr?.failureCode || "Dépôt échoué (callback)";
      try {
        await applyFailedByPawapayDepositId(prisma, depositId, msg);
      } catch (e) {
        console.error("[webhooks/pawapay/deposit] FAILED", e);
        return res.status(500).json({ error: "Traitement impossible" });
      }
      return res.json({ ok: true });
    }

    if (status !== "COMPLETED") {
      return res.status(400).json({ error: `Statut callback non géré : ${status}` });
    }

    try {
      await finalizeCompletedByPawapayDepositId(prisma, depositId);
    } catch (e) {
      console.error("[webhooks/pawapay/deposit] COMPLETED", e);
      return res.status(500).json({ error: "Traitement impossible" });
    }
    return res.json({ ok: true });
  }

  return {
    postWalletDeposit,
    getWalletDepositStatus,
    postPawapayDepositWebhook,
  };
}

function trimStrParam(v) {
  const s = String(v ?? "").trim();
  return s.length > 0 ? s : null;
}
