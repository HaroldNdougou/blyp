import { createHash, randomBytes, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

const ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || "1h";
/** 180 jours */
const REFRESH_TTL_MS = 180 * 24 * 60 * 60 * 1000;

function hashRefreshToken(raw) {
  return createHash("sha256").update(String(raw), "utf8").digest("hex");
}

function newRefreshRaw() {
  return randomBytes(32).toString("base64url");
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {string} jwtSecret
 */
export function createRefreshSessionHelpers(prisma, jwtSecret) {
  function signAccessToken(userId) {
    return jwt.sign({ sub: userId, typ: "access" }, jwtSecret, {
      expiresIn: ACCESS_EXPIRY,
    });
  }

  async function revokeFamily(familyId) {
    await prisma.refreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async function issueAuthSession(userId) {
    const token = signAccessToken(userId);
    const refreshToken = newRefreshRaw();
    const tokenHash = hashRefreshToken(refreshToken);
    const familyId = randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    await prisma.refreshSession.create({
      data: { userId, tokenHash, familyId, expiresAt },
    });
    return { token, refreshToken };
  }

  async function rotateAuthSession(refreshTokenRaw) {
    const raw = String(refreshTokenRaw ?? "").trim();
    if (!raw || raw.length < 20) return null;

    const tokenHash = hashRefreshToken(raw);
    const row = await prisma.refreshSession.findUnique({ where: { tokenHash } });
    if (!row) return null;

    if (row.revokedAt) {
      await revokeFamily(row.familyId);
      return null;
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      await prisma.refreshSession
        .delete({ where: { id: row.id } })
        .catch(() => {});
      return null;
    }

    const marked = await prisma.refreshSession.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (marked.count === 0) {
      await revokeFamily(row.familyId);
      return null;
    }

    await prisma.refreshSession
      .delete({ where: { id: row.id } })
      .catch(() => {});

    const token = signAccessToken(row.userId);
    const nextRaw = newRefreshRaw();
    const nextHash = hashRefreshToken(nextRaw);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    await prisma.refreshSession.create({
      data: {
        userId: row.userId,
        tokenHash: nextHash,
        familyId: row.familyId,
        expiresAt,
      },
    });
    return { token, refreshToken: nextRaw };
  }

  return { issueAuthSession, rotateAuthSession, signAccessToken };
}
