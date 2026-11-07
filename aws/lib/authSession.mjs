/**
 * Une session active par compte — nouvelle connexion ⇒ l’ancien téléphone est déconnecté.
 */
import { parseAccessToken } from "./jwt.mjs";
import { getActiveSessionFamilyId } from "./refreshTokens.mjs";

export async function resolveUserIdFromAccessToken(tokenRaw) {
  return (await resolveAccessSession(tokenRaw)).userId;
}

/**
 * Action d’argent signée par la clé appareil : un access expiré depuis < 7 j reste accepté
 * (le téléphone paie sans attendre le renouvellement). Exige clé liée + session encore active.
 */
const SIGNED_ACCESS_GRACE_SEC = 7 * 24 * 3600;

/**
 * @param {{ signedRoute?: boolean }} [opts]
 * @returns {{ userId: string, devicePublicKey: string | null }}
 */
export async function resolveAccessSession(tokenRaw, { signedRoute = false } = {}) {
  const raw = String(tokenRaw ?? "").trim();
  if (!raw) throw new Error("INVALID_TOKEN");
  let parsed;
  let expiredGrace = false;
  try {
    parsed = await parseAccessToken(raw);
  } catch (e) {
    if (!signedRoute || e?.code !== "ERR_JWT_EXPIRED") throw e;
    parsed = await parseAccessToken(raw, { clockToleranceSec: SIGNED_ACCESS_GRACE_SEC });
    if (!parsed.devicePublicKey || !parsed.sessionFamilyId) throw e;
    expiredGrace = true;
  }
  const { userId, sessionFamilyId, devicePublicKey } = parsed;
  if (!userId) throw new Error("INVALID_TOKEN");

  const activeFamilyId = await getActiveSessionFamilyId(userId);
  if (expiredGrace && !activeFamilyId) throw new Error("INVALID_TOKEN");
  if (activeFamilyId) {
    if (!sessionFamilyId || sessionFamilyId !== activeFamilyId) {
      throw new Error("SESSION_REPLACED");
    }
  }
  return { userId, devicePublicKey };
}
