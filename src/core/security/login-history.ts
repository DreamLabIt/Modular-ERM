import type { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';

export type LoginEventStatus = 'SUCCESS' | 'FAILED' | 'BLOCKED' | 'LOGOUT';

export interface LoginEventInput {
  organizationId?: string | null;
  userId?: string | null;
  email: string;
  status: LoginEventStatus;
  failureReason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export function deviceFromUserAgent(userAgent?: string | null): string | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  const browser = ua.includes('edg/') ? 'Edge'
    : ua.includes('chrome/') ? 'Chrome'
    : ua.includes('firefox/') ? 'Firefox'
    : ua.includes('safari/') ? 'Safari'
    : 'Browser';
  const os = ua.includes('windows') ? 'Windows'
    : ua.includes('android') ? 'Android'
    : ua.includes('iphone') || ua.includes('ipad') ? 'iOS'
    : ua.includes('mac os') ? 'macOS'
    : ua.includes('linux') ? 'Linux'
    : 'Unknown';
  return `${browser} on ${os}`;
}

/**
 * Records authentication activity. Never stores passwords, tokens, or other
 * authentication secrets.
 */
export async function recordLoginEvent(input: LoginEventInput) {
  return prisma.loginHistory.create({
    data: {
      organizationId: input.organizationId ?? null,
      userId: input.userId ?? null,
      email: input.email.slice(0, 254),
      status: input.status,
      failureReason: input.failureReason ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
      device: deviceFromUserAgent(input.userAgent),
    },
  });
}

export interface LoginHistorySearch {
  organizationId: string;
  page?: number;
  pageSize?: number;
  userId?: string;
  email?: string;
  status?: string;
  from?: Date;
  to?: Date;
}

export async function searchLoginHistory(input: LoginHistorySearch) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, input.pageSize ?? 25));
  const where: Prisma.LoginHistoryWhereInput = {
    organizationId: input.organizationId,
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.email ? { email: { contains: input.email, mode: 'insensitive' } } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.from || input.to
      ? {
          createdAt: {
            ...(input.from ? { gte: input.from } : {}),
            ...(input.to ? { lte: input.to } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.loginHistory.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { name: true } } },
    }),
    prisma.loginHistory.count({ where }),
  ]);

  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export function getClientRequestInfo(request?: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  if (!request?.headers) return { ipAddress: null, userAgent: null };
  const forwardedFor = request.headers.get('x-forwarded-for');
  return {
    ipAddress: forwardedFor?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null,
    userAgent: request.headers.get('user-agent'),
  };
}
