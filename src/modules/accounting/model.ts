import { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { recordAuditLog } from '@/core/audit';
import { roundMoney } from '@/shared/utils/money';
import type { CreateTransactionInput } from '@/core/types';
import { createJournalEntryInTx, ensureDefaultChartOfAccounts } from './service';

export async function createTransaction(input: CreateTransactionInput, actorUserId?: string) {
  return prisma.$transaction(async (tx) => {
    const created = await tx.accountTransaction.create({
      data: {
        organizationId: input.organizationId,
        type: input.type,
        category: input.category,
        reference: input.reference,
        description: input.description,
        amount: input.amount,
      },
    });

    // Also create a balanced double-entry journal entry for every manual transaction
    const accounts = await ensureDefaultChartOfAccounts(tx, input.organizationId);
    const bank = accounts.get('1010')!;
    const revenue = accounts.get('4000')!;
    const expense = accounts.get('5200')!;
    const amt = roundMoney(input.amount);

    if (amt.gt(0)) {
      await createJournalEntryInTx(tx, {
        organizationId: input.organizationId,
        entryDate: new Date(),
        description: `${input.category}: ${input.description}`,
        reference: input.reference ?? created.id,
        sourceType: 'MANUAL_TX',
        sourceId: created.id,
        idempotencyKey: `ACCOUNT_TX:${created.id}`,
        postImmediately: true,
        actorUserId: actorUserId ?? null,
        lines:
          input.type === 'INCOME'
            ? [
                { accountId: bank.id, description: input.description, debit: amt, credit: 0 },
                { accountId: revenue.id, description: input.category, debit: 0, credit: amt },
              ]
            : [
                { accountId: expense.id, description: input.category, debit: amt, credit: 0 },
                { accountId: bank.id, description: input.description, debit: 0, credit: amt },
              ],
      });
    }
    return created;
  });
}

export async function listTransactions(organizationId: string) {
  return prisma.accountTransaction.findMany({
    where: { organizationId },
    orderBy: { date: 'desc' },
  });
}

export async function listAccounts(organizationId: string) {
  await prisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx, organizationId));
  return prisma.account.findMany({
    where: { organizationId },
    include: { parent: { select: { id: true, code: true, name: true } } },
    orderBy: { code: 'asc' },
  });
}

export async function createAccount(input: {
  organizationId: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  parentId?: string;
  description?: string;
  actorUserId: string;
}) {
  return prisma.$transaction(async (tx) => {
    if (input.parentId) {
      const parent = await tx.account.findFirst({
        where: { id: input.parentId, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!parent) return { success: false as const, error: 'Parent account not found in this organization.' };
    }
    const account = await tx.account.create({
      data: {
        organizationId: input.organizationId,
        code: input.code,
        name: input.name,
        type: input.type,
        parentId: input.parentId ?? null,
        description: input.description ?? null,
      },
    });
    await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        targetType: 'ACCOUNT',
        targetId: account.id,
        action: 'ACCOUNT_CREATED',
        after: { code: account.code, name: account.name, type: account.type },
      },
      tx,
    );
    return { success: true as const, data: account };
  });
}

export async function toggleAccountActive(organizationId: string, accountId: string, isActive: boolean, actorUserId: string) {
  return prisma.$transaction(async (tx) => {
    const account = await tx.account.findFirst({ where: { id: accountId, organizationId } });
    if (!account) return { success: false as const, error: 'Account not found.' };
    if (account.isSystem && !isActive) {
      return { success: false as const, error: 'System accounts cannot be deactivated.' };
    }
    await tx.account.update({ where: { id: account.id }, data: { isActive } });
    await recordAuditLog(
      {
        organizationId,
        actorUserId,
        targetType: 'ACCOUNT',
        targetId: account.id,
        action: isActive ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_DEACTIVATED',
      },
      tx,
    );
    return { success: true as const };
  });
}

export async function listJournalEntries(organizationId: string, status?: string) {
  return prisma.journalEntry.findMany({
    where: { organizationId, ...(status && status !== 'ALL' ? { status } : {}) },
    include: {
      lines: { include: { account: { select: { id: true, code: true, name: true, type: true } } } },
      createdBy: { select: { name: true } },
    },
    orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
}

export async function listBankAccounts(organizationId: string) {
  await prisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx, organizationId));
  return prisma.bankAccount.findMany({
    where: { organizationId },
    include: {
      ledgerAccount: { select: { id: true, code: true, name: true } },
      transactions: { orderBy: { transactionDate: 'desc' }, take: 25 },
      reconciliations: { orderBy: { statementDate: 'desc' }, take: 10 },
    },
    orderBy: { bankName: 'asc' },
  });
}

export async function createBankAccount(input: {
  organizationId: string;
  accountId: string;
  bankName: string;
  accountNumber: string;
  accountType: 'BANK' | 'CASH';
  currency: string;
  openingBalance: number;
  actorUserId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const ledgerAcc = await tx.account.findFirst({
      where: { id: input.accountId, organizationId: input.organizationId, type: 'ASSET' },
    });
    if (!ledgerAcc) {
      return { success: false as const, error: 'Linked Chart of Accounts entry must be an active ASSET account.' };
    }
    const opening = roundMoney(input.openingBalance);
    const bank = await tx.bankAccount.create({
      data: {
        organizationId: input.organizationId,
        accountId: ledgerAcc.id,
        bankName: input.bankName,
        accountNumber: input.accountNumber,
        accountType: input.accountType,
        currency: input.currency,
        openingBalance: opening,
        currentBalance: opening,
      },
    });
    await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        targetType: 'BANK_ACCOUNT',
        targetId: bank.id,
        action: 'BANK_ACCOUNT_CREATED',
        after: { bankName: bank.bankName, accountNumber: bank.accountNumber },
      },
      tx,
    );
    return { success: true as const, data: bank };
  });
}

export async function recordBankTransaction(input: {
  organizationId: string;
  bankAccountId: string;
  transactionDate: Date;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER' | 'FEE';
  amount: number;
  reference?: string;
  description: string;
  counterAccountId?: string;
  actorUserId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const bank = await tx.bankAccount.findFirst({
      where: { id: input.bankAccountId, organizationId: input.organizationId, isActive: true },
    });
    if (!bank) return { success: false as const, error: 'Bank account not found.' };

    const amt = roundMoney(input.amount);
    const delta = input.type === 'DEPOSIT' ? amt : amt.neg();
    const newBalance = new Prisma.Decimal(bank.currentBalance).plus(delta);

    const accounts = await ensureDefaultChartOfAccounts(tx, input.organizationId);
    const fallbackCounter = input.type === 'DEPOSIT' ? accounts.get('4000')! : accounts.get('5200')!;
    const counterId = input.counterAccountId || fallbackCounter.id;

    const je = await createJournalEntryInTx(tx, {
      organizationId: input.organizationId,
      entryDate: input.transactionDate,
      description: `${bank.bankName} ${input.type}: ${input.description}`,
      reference: input.reference ?? bank.accountNumber,
      sourceType: 'BANK_TX',
      sourceId: bank.id,
      postImmediately: true,
      actorUserId: input.actorUserId,
      lines:
        input.type === 'DEPOSIT'
          ? [
              { accountId: bank.accountId, description: input.description, debit: amt, credit: 0 },
              { accountId: counterId, description: input.description, debit: 0, credit: amt },
            ]
          : [
              { accountId: counterId, description: input.description, debit: amt, credit: 0 },
              { accountId: bank.accountId, description: input.description, debit: 0, credit: amt },
            ],
    });
    if (!je.success) return je;

    await tx.bankAccount.update({
      where: { id: bank.id },
      data: { currentBalance: newBalance },
    });

    const bankTx = await tx.bankTransaction.create({
      data: {
        organizationId: input.organizationId,
        bankAccountId: bank.id,
        transactionDate: input.transactionDate,
        type: input.type,
        amount: amt,
        reference: input.reference ?? null,
        description: input.description,
        journalEntryId: je.data.id,
      },
    });

    return { success: true as const, data: bankTx };
  });
}

export async function reconcileBankAccount(input: {
  organizationId: string;
  bankAccountId: string;
  statementDate: Date;
  statementBalance: number;
  notes?: string;
  reconcileTransactionIds: string[];
  actorUserId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const bank = await tx.bankAccount.findFirst({
      where: { id: input.bankAccountId, organizationId: input.organizationId },
    });
    if (!bank) return { success: false as const, error: 'Bank account not found.' };

    if (input.reconcileTransactionIds.length > 0) {
      await tx.bankTransaction.updateMany({
        where: {
          organizationId: input.organizationId,
          bankAccountId: bank.id,
          id: { in: input.reconcileTransactionIds },
        },
        data: { isReconciled: true, reconciledAt: new Date() },
      });
    }

    const stmtBal = roundMoney(input.statementBalance);
    const bookBal = roundMoney(bank.currentBalance);
    const diff = stmtBal.minus(bookBal);

    const rec = await tx.bankReconciliation.create({
      data: {
        organizationId: input.organizationId,
        bankAccountId: bank.id,
        statementDate: input.statementDate,
        statementBalance: stmtBal,
        bookBalance: bookBal,
        difference: diff,
        status: diff.eq(0) ? 'RECONCILED' : 'VARIANCE_NOTED',
        notes: input.notes ?? null,
      },
    });

    await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        targetType: 'BANK_RECONCILIATION',
        targetId: rec.id,
        action: 'BANK_RECONCILED',
        after: { statementBalance: stmtBal.toFixed(2), bookBalance: bookBal.toFixed(2), difference: diff.toFixed(2) },
      },
      tx,
    );

    return { success: true as const, data: rec };
  });
}
