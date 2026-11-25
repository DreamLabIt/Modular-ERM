import { z } from 'zod';
import {
  cuidIdSchema,
  dateStringSchema,
  nonEmptyString,
  nonNegativeMoneySchema,
  optionalText,
  positiveMoneySchema,
} from '@/core/validation';

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const JOURNAL_STATUSES = ['DRAFT', 'POSTED', 'REVERSED'] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export const createAccountSchema = z.object({
  code: nonEmptyString('Account code', 20).regex(/^[A-Za-z0-9\-]+$/, 'Account code must be alphanumeric.'),
  name: nonEmptyString('Account name', 120),
  type: z.enum(ACCOUNT_TYPES),
  parentId: cuidIdSchema.optional(),
  description: optionalText(500),
});

export const journalLineInputSchema = z
  .object({
    accountId: cuidIdSchema,
    description: optionalText(300),
    debit: nonNegativeMoneySchema,
    credit: nonNegativeMoneySchema,
  })
  .refine(
    (line) => (line.debit > 0 && line.credit === 0) || (line.credit > 0 && line.debit === 0),
    'Each journal line must have either a positive debit or a positive credit (not both).',
  );

export const createJournalEntrySchema = z.object({
  entryDate: dateStringSchema,
  description: nonEmptyString('Description', 500),
  reference: optionalText(100),
  postImmediately: z.boolean().default(false),
  lines: z.array(journalLineInputSchema).min(2, 'At least two journal lines are required.'),
});

export const createBankAccountSchema = z.object({
  accountId: cuidIdSchema,
  bankName: nonEmptyString('Bank or cash account name', 120),
  accountNumber: nonEmptyString('Account number', 60),
  accountType: z.enum(['BANK', 'CASH']),
  currency: z.string().trim().min(3).max(5).toUpperCase().default('BDT'),
  openingBalance: nonNegativeMoneySchema.default(0),
});

export const createBankTransactionSchema = z.object({
  bankAccountId: cuidIdSchema,
  transactionDate: dateStringSchema,
  type: z.enum(['DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'FEE']),
  amount: positiveMoneySchema,
  reference: optionalText(100),
  description: nonEmptyString('Description', 400),
  counterAccountId: cuidIdSchema.optional(),
});

export const createReconciliationSchema = z.object({
  bankAccountId: cuidIdSchema,
  statementDate: dateStringSchema,
  statementBalance: z.coerce.number().refine(Number.isFinite, 'Statement balance must be a valid number.'),
  notes: optionalText(500),
  reconcileTransactionIds: z.array(cuidIdSchema).default([]),
});
