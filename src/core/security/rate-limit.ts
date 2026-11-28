import { prisma } from '@/core/db/prisma';

export interface RateLimitConfig {
  /** Maximum number of attempts allowed inside the window. */
  limit: number;
  /** Window size in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: Date;
  backend: 'redis' | 'database';
}

interface BucketRow {
  count: number;
}

/**
 * Distributed fixed-window rate limiter.
 *
 * - Uses Upstash Redis REST when UPSTASH_REDIS_REST_URL and
 *   UPSTASH_REDIS_REST_TOKEN are configured.
 * - Falls back to a PostgreSQL-backed bucket table, which works across
 *   multiple application instances. In-memory counters are deliberately not
 *   used for production enforcement.
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const normalizedKey = key.slice(0, 300);
  const windowMs = Math.max(1, config.windowSeconds) * 1000;
  const now = Date.now();
  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  const resetAt = new Date(windowStartMs + windowMs);

  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (upstashUrl && upstashToken) {
    try {
      return await checkRedisRateLimit(normalizedKey, config, resetAt, upstashUrl, upstashToken);
    } catch (error) {
      console.error('[rate-limit] Redis backend failed, using database fallback', error);
    }
  }

  return checkDatabaseRateLimit(normalizedKey, config, windowStartMs, resetAt);
}

async function checkDatabaseRateLimit(
  key: string,
  config: RateLimitConfig,
  windowStartMs: number,
  resetAt: Date,
): Promise<RateLimitResult> {
  const windowStart = new Date(windowStartMs);
  const rows = await prisma.$queryRaw<BucketRow[]>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count", "expiresAt")
    VALUES (${key}, ${windowStart}, 1, ${resetAt})
    ON CONFLICT ("key", "windowStart")
    DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count"
  `;

  // Opportunistic cleanup of expired buckets.
  if (Math.random() < 0.02) {
    prisma.rateLimitBucket
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch((error) => console.error('[rate-limit] cleanup failed', error));
  }

  const count = rows[0]?.count ?? 1;
  return buildResult(count, config, resetAt, 'database');
}

async function checkRedisRateLimit(
  key: string,
  config: RateLimitConfig,
  resetAt: Date,
  url: string,
  token: string,
): Promise<RateLimitResult> {
  const windowStart = Math.floor(Date.now() / (config.windowSeconds * 1000));
  const redisKey = `ratelimit:${key}:${windowStart}`;

  const response = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', redisKey],
      ['EXPIRE', redisKey, config.windowSeconds, 'NX'],
    ]),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Redis rate limit request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as Array<{ result?: number | string }>;
  const count = Number(payload[0]?.result ?? 1);
  return buildResult(count, config, resetAt, 'redis');
}

function buildResult(
  count: number,
  config: RateLimitConfig,
  resetAt: Date,
  backend: 'redis' | 'database',
): RateLimitResult {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
  return {
    allowed: count <= config.limit,
    limit: config.limit,
    remaining: Math.max(0, config.limit - count),
    retryAfterSeconds,
    resetAt,
    backend,
  };
}

export class RateLimitError extends Error {
  readonly statusCode = 429;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Too many requests. Please try again later.');
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function enforceRateLimit(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const result = await checkRateLimit(key, config);
  if (!result.allowed) {
    throw new RateLimitError(result.retryAfterSeconds);
  }
  return result;
}
