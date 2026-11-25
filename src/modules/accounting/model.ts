import { prisma } from '@/core/db/prisma';
import type { CreateTransactionInput } from '@/core/types';

export async function createTransaction(input: CreateTransactionInput) {
  await prisma.accountTransaction.create({
    data: {
      organizationId: input.organizationId,
      type: input.type,
      category: input.category,
      reference: input.reference,
      description: input.description,
      amount: input.amount,
    },
  });
}

export async function listTransactions(organizationId: string) {
  return prisma.accountTransaction.findMany({
    where: { organizationId },
    orderBy: { date: 'desc' },
  });
}
