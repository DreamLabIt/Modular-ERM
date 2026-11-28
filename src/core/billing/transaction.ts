import type { Prisma, PrismaClient } from '@prisma/client';

export type BillingDb = Prisma.TransactionClient | PrismaClient;

/**
 * Runs work in a transaction when called with the root client, or directly
 * when the caller already owns a transaction (Prisma cannot nest $transaction
 * calls on a transaction client).
 */
export async function inTransaction<T>(db: BillingDb, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if ('$transaction' in db) return db.$transaction(fn);
  return fn(db as Prisma.TransactionClient);
}
