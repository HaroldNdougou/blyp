import { createHash, randomInt } from "node:crypto";

export const OTP_RESEND_COOLDOWN_MS = 60_000;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_VERIFY_IDEMPOTENCY_MS = 120_000;

/**
 * TEMP — contournement Obit/Orange. À retirer dès que les SMS sont fiables.
 * Vérifier avec ce code après « Continuer » (même si le SMS n’arrive pas).
 */
export const TEMP_DEV_OTP_CODE = "1234";

function getOtpPepper() {
  return String(process.env.OTP_PEPPER ?? "pepper").trim() || "pepper";
}

export function hashOtp(phone, code) {
  return createHash("sha256")
    .update(`${getOtpPepper()}|${phone}|${code}`)
    .digest("hex");
}

export function generateOtpCode() {
  return String(randomInt(100_000, 1_000_000));
}

export function otpVerifyCacheKey(phone, code) {
  return `${phone}|${hashOtp(phone, code)}`;
}
