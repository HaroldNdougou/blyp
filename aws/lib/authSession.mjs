/**
 * Une session active par compte — nouvelle connexion ⇒ l’ancien téléphone est déconnecté.
 */
import { parseAccessToken } from "./jwt.mjs";
import { getActiveSessionFamilyId } from "./refreshTokens.mjs";

export async function resolveUserIdFromAccessToken(tokenRaw) {
  return (await resolveAccessSession(tokenRaw)).userId;
}

/** @returns {{ userId: string, devicePublicKey: string | null }} */
export async function resolveAccessSession(tokenRaw) {
  const raw = String(tokenRaw ?? "").trim();
  if (!raw) throw new Error("INVALID_TOKEN");
  const { userId, sessionFamilyId, devicePublicKey } = await parseAccessToken(raw);
  if (!userId) throw new Error("INVALID_TOKEN");

  const activeFamilyId = await getActiveSessionFamilyId(userId);
  if (activeFamilyId) {
    if (!sessionFamilyId || sessionFamilyId !== activeFamilyId) {
      throw new Error("SESSION_REPLACED");
    }
  }
  return { userId, devicePublicKey };
}
