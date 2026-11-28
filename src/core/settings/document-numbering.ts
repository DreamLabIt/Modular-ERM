import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { getOrganizationSettings, fiscalYearLabelForDate } from '@/core/settings';
import { ValidationError } from '@/core/errors';

export const DOCUMENT_TYPES = {
  SALES_INVOICE: { label: 'Sales Invoice', prefix: 'INV', includeFiscalYear: true },
  PURCHASE_ORDER: { label: 'Purchase Order', prefix: 'PO', includeFiscalYear: true },
  QUOTATION: { label: 'Quotation', prefix: 'QT', includeFiscalYear: true },
  PAYMENT_RECEIPT: { label: 'Payment Receipt', prefix: 'PAY', includeFiscalYear: true },
  CREDIT_NOTE: { label: 'Credit Note', prefix: 'CN', includeFiscalYear: true },
  DEBIT_NOTE: { label: 'Debit Note', prefix: 'DN', includeFiscalYear: true },
  JOURNAL_ENTRY: { label: 'Journal Entry', prefix: 'JE', includeFiscalYear: true },
  PAYROLL_RUN: { label: 'Payroll Run', prefix: 'PRUN', includeFiscalYear: true },
  PURCHASE_REQUISITION: { label: 'Purchase Requisition', prefix: 'PR', includeFiscalYear: true },
} as const;

export type DocumentType = keyof typeof DOCUMENT_TYPES;

export function isDocumentType(value: string): value is DocumentType {
  return value in DOCUMENT_TYPES;
}

interface SequenceRow {
  id: string;
  prefix: string;
  suffix: string;
  padding: number;
  includeFiscalYear: boolean;
  includeDate: boolean;
  nextNumber: number;
  resetPolicy: string;
}

export function formatDocumentNumber(
  sequence: Pick<
    SequenceRow,
    'prefix' | 'suffix' | 'padding' | 'includeFiscalYear' | 'includeDate'
  >,
  number: number,
  fiscalYearLabel: string,
  date: Date,
): string {
  const parts: string[] = [];
  const prefix = sequence.prefix.trim().replace(/-+$/, '');
  if (prefix) parts.push(prefix);
  if (sequence.includeFiscalYear) parts.push(fiscalYearLabel);
  if (sequence.includeDate) {
    parts.push(
      `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
        date.getUTCDate(),
      ).padStart(2, '0')}`,
    );
  }
  parts.push(String(number).padStart(Math.min(12, Math.max(1, sequence.padding)), '0'));
  if (sequence.suffix.trim()) parts.push(sequence.suffix.trim());
  return parts.join('-');
}

async function ensureSequence(
  tx: Prisma.TransactionClient,
  organizationId: string,
  documentType: DocumentType,
) {
  const existing = await tx.documentSequence.findUnique({
    where: { organizationId_documentType: { organizationId, documentType } },
  });
  if (existing) return existing;

  const defaults = DOCUMENT_TYPES[documentType];
  // INSERT ... ON CONFLICT DO NOTHING is safe under concurrency: a losing
  // inserter does not abort its transaction and simply reads the winner's row.
  await tx.$executeRaw`
    INSERT INTO "DocumentSequence"
      ("id", "organizationId", "documentType", "prefix", "suffix", "startingNumber",
       "padding", "includeFiscalYear", "includeDate", "nextNumber", "resetPolicy",
       "createdAt", "updatedAt")
    VALUES
      (${randomUUID()}, ${organizationId}, ${documentType}, ${defaults.prefix}, '', 1,
       6, ${defaults.includeFiscalYear}, false, 1, 'YEARLY', NOW(), NOW())
    ON CONFLICT ("organizationId", "documentType") DO NOTHING
  `;
  const row = await tx.documentSequence.findUnique({
    where: { organizationId_documentType: { organizationId, documentType } },
  });
  if (!row) throw new ValidationError('Could not initialise the document sequence.');
  return row;
}

/**
 * Atomically allocates the next document number.
 *
 * The increment and yearly reset happen in a single UPDATE statement, so two
 * concurrent requests can never receive the same number. Callers must pass the
 * surrounding Prisma transaction so the document insert and number allocation
 * commit or roll back together.
 */
export async function allocateDocumentNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
  documentType: DocumentType,
  now = new Date(),
): Promise<string> {
  const sequence = await ensureSequence(tx, organizationId, documentType);
  const settings = await getOrganizationSettings(organizationId, tx);
  const fiscal = fiscalYearLabelForDate(now, settings);
  const fiscalYear = Number(fiscal.label);

  const rows = await tx.$queryRaw<Array<{ nextNumber: number; lastResetYear: number | null }>>`
    UPDATE "DocumentSequence"
    SET "nextNumber" = CASE
          WHEN "resetPolicy" = 'YEARLY' AND ("lastResetYear" IS NULL OR "lastResetYear" <> ${fiscalYear})
          THEN "startingNumber" + 1
          ELSE "nextNumber" + 1
        END,
        "lastResetYear" = CASE
          WHEN "resetPolicy" = 'YEARLY' AND ("lastResetYear" IS NULL OR "lastResetYear" <> ${fiscalYear})
          THEN ${fiscalYear}
          ELSE "lastResetYear"
        END,
        "updatedAt" = NOW()
    WHERE "id" = ${sequence.id} AND "organizationId" = ${organizationId}
    RETURNING "nextNumber", "lastResetYear"
  `;

  const nextNumber = rows[0]?.nextNumber;
  if (!nextNumber) throw new ValidationError('Could not allocate a document number.');

  return formatDocumentNumber(
    {
      prefix: sequence.prefix,
      suffix: sequence.suffix,
      padding: sequence.padding,
      includeFiscalYear: sequence.includeFiscalYear,
      includeDate: sequence.includeDate,
    },
    nextNumber - 1,
    fiscal.label,
    now,
  );
}

export function previewDocumentNumber(
  sequence: {
    prefix: string;
    suffix: string;
    padding: number;
    includeFiscalYear: boolean;
    includeDate: boolean;
    nextNumber: number;
  },
  settings: Parameters<typeof fiscalYearLabelForDate>[1],
  now = new Date(),
): string {
  const fiscal = fiscalYearLabelForDate(now, settings);
  return formatDocumentNumber(sequence, sequence.nextNumber, fiscal.label, now);
}
