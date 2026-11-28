import { randomUUID } from 'crypto';
import { prisma } from '@/core/db/prisma';

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface CreateSessionInput {
  organizationId: string;
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface SessionValidation {
  valid: boolean;
  sessionId?: string;
  organizationId?: string;
  userId?: string;
  reason?: 'NOT_FOUND' | 'REVOKED' | 'EXPIRED';
}

export function describeUserAgent(userAgent?: string | null): string {
  if (!userAgent) return 'Unknown device';
  const ua = userAgent.toLowerCase();
  const browser =
    ua.includes('edg/') ? 'Edge'
    : ua.includes('chrome/') ? 'Chrome'
    : ua.includes('firefox/') ? 'Firefox'
    : ua.includes('safari/') ? 'Safari'
    : 'Browser';
  const os =
    ua.includes('windows') ? 'Windows'
    : ua.includes('android') ? 'Android'
    : ua.includes('iphone') || ua.includes('ipad') ? 'iOS'
    : ua.includes('mac os') ? 'macOS'
    : ua.includes('linux') ? 'Linux'
    : 'Unknown OS';
  return `${browser} on ${os}`;
}

export async function createUserSession(input: CreateSessionInput) {
  const tokenId = randomUUID();
  const session = await prisma.userSession.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      tokenId,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      device: describeUserAgent(input.userAgent),
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    },
  });
  return { session, tokenId };
}

/**
 * Called from the NextAuth JWT callback. A revoked or expired session must be
 * rejected even though the JWT itself is still cryptographically valid.
 */
export async function validateSessionToken(tokenId: string): Promise<SessionValidation> {
  if (!tokenId) return { valid: false, reason: 'NOT_FOUND' };
  const session = await prisma.userSession.findUnique({ where: { tokenId } });
  if (!session) return { valid: false, reason: 'NOT_FOUND' };
  if (session.revokedAt) {
    return { valid: false, reason: 'REVOKED', sessionId: session.id, userId: session.userId };
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    return { valid: false, reason: 'EXPIRED', sessionId: session.id, userId: session.userId };
  }
  return {
    valid: true,
    sessionId: session.id,
    organizationId: session.organizationId,
    userId: session.userId,
  };
}

export async function touchSession(tokenId: string) {
  await prisma.userSession
    .updateMany({
      where: {
        tokenId,
        revokedAt: null,
        lastSeenAt: { lt: new Date(Date.now() - 5 * 60 * 1000) },
      },
      data: { lastSeenAt: new Date() },
    })
    .catch(() => undefined);
}

export async function revokeSessionById(
  organizationId: string,
  sessionId: string,
  revokedById: string,
  reason = 'REVOKED_BY_ADMIN',
) {
  const result = await prisma.userSession.updateMany({
    where: { id: sessionId, organizationId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason, revokedById },
  });
  return result.count === 1;
}

export async function revokeSessionByToken(
  tokenId: string,
  reason = 'LOGOUT',
  revokedById?: string,
) {
  if (!tokenId) return false;
  const result = await prisma.userSession.updateMany({
    where: { tokenId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason, revokedById: revokedById ?? null },
  });
  return result.count === 1;
}

export async function revokeUserSessions(
  organizationId: string,
  userId: string,
  reason: string,
  exceptTokenId?: string,
) {
  const result = await prisma.userSession.updateMany({
    where: {
      organizationId,
      userId,
      revokedAt: null,
      ...(exceptTokenId ? { tokenId: { not: exceptTokenId } } : {}),
    },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

export async function listUserSessions(organizationId: string, userId: string) {
  return prisma.userSession.findMany({
    where: { organizationId, userId },
    orderBy: [{ revokedAt: 'asc' }, { lastSeenAt: 'desc' }],
    take: 100,
  });
}

export async function listOrganizationSessions(organizationId: string, take = 100) {
  return prisma.userSession.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take,
    include: { user: { select: { name: true, email: true } } },
  });
}

export async function purgeExpiredSessions(olderThanDays = 30) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  return prisma.userSession.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
}
