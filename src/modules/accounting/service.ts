import { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { recordAuditLog } from '@/core/audit';
import { roundMoney, toDecimal } from '@/shared/utils/money';
import type { ActionResult } from '@/core/errors';

export const SYSTEM_ACCOUNTS: Array<{ code: string; name: string; type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'; description: string }> = [
  { code: '1000', name: 'Cash on Hand', type: 'ASSET', description: 'Physical petty cash and cash registers' },
  { code: '1010', name: 'Bank Account', type: 'ASSET', description: 'Primary operating bank account' },
  { code: '1100', name: 'Accounts Receivable', type: 'ASSET', description: 'Amounts owed by customers' },
  { code: '1200', name: 'Inventory Asset', type: 'ASSET', description: 'Valuation of stock held in warehouses' },
  { code: '2000', name: 'Accounts Payable', type: 'LIABILITY', description: 'Amounts owed to suppliers' },
  { code: '2100', name: 'Goods Received Not Invoiced', type: 'LIABILITY', description: 'Accrued liability for accepted GRNs awaiting supplier bills' },
  { code: '2200', name: 'Sales Tax Payable', type: 'LIABILITY', description: 'Collected VAT/GST/Sales Tax payable' },
  { code: '2300', name: 'Payroll & Statutory Payable', type: 'LIABILITY', description: 'Accrued salaries, taxes, and provident fund deductions' },
  { code: '3000', name: 'Owner Equity', type: 'EQUITY', description: 'Initial capital and owner contributions' },
  { code: '3100', name: 'Retained Earnings', type: 'EQUITY', description: 'Accumulated net profits' },
  { code: '4000', name: 'Sales Revenue', type: 'REVENUE', description: 'Revenue from goods and services' },
  { code: '4100', name: 'Sales Returns & Allowances', type: 'REVENUE', description: 'Contra-revenue for credit notes and sales returns' },
  { code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE', description: 'Direct inventory cost of goods sold' },
  { code: '5100', name: 'Payroll & Salary Expense', type: 'EXPENSE', description: 'Gross employee salaries, allowances, and overtime' },
  { code: '5200', name: 'Operating & Project Expense', type: 'EXPENSE', description: 'General operating, cloud, and project expenses' },
  { code: '5300', name: 'Inventory Shrinkage & Adjustments', type: 'EXPENSE', description: 'Damaged, lost, or expired stock write-offs' },
];

type TxOrClient = Prisma.TransactionClient;

/**
 * Idempotently provisions default Chart of Accounts for an organization.
 * Returns a map from account code -> account record.
 */
export async function ensureDefaultChartOfAccounts(
  tx: TxOrClient,
  organizationId: string,
) {
  const existing = await tx.account.findMany({
    where: { organizationId },
  });
  const byCode = new Map(existing.map((acc) => [acc.code, acc]));

  for (const def of SYSTEM_ACCOUNTS) {
    if (!byCode.has(def.code)) {
      const created = await tx.account.create({
        data: {
          organizationId,
          code: def.code,
          name: def.name,
          type: def.type,
          description: def.description,
          isSystem: true,
          isActive: true,
        },
      });
      byCode.set(created.code, created);
    }
  }
  return byCode;
}

function generateEntryNumber() {
  return `JE-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export interface JournalLineInput {
  accountId: string;
  description?: string;
  debit: number | string | Prisma.Decimal;
  credit: number | string | Prisma.Decimal;
}

export interface CreateJournalEntryInput {
  organizationId: string;
  entryDate: Date;
  description: string;
  reference?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  idempotencyKey?: string | null;
  postImmediately: boolean;
  actorUserId?: string | null;
  lines: JournalLineInput[];
}

export async function createJournalEntryInTx(
  tx: TxOrClient,
  input: CreateJournalEntryInput,
): Promise<ActionResult<{ id: string; entryNumber: string; duplicate?: boolean }>> {
  if (input.idempotencyKey) {
    const existing = await tx.journalEntry.findFirst({
      where: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey },
      select: { id: true, entryNumber: true },
    });
    if (existing) {
      return { success: true, data: { id: existing.id, entryNumber: existing.entryNumber, duplicate: true } };
    }
  }

  if (!input.lines || input.lines.length < 2) {
    return { success: false, error: 'A journal entry requires at least two lines.' };
  }

  const accountIds = Array.from(new Set(input.lines.map((l) => l.accountId)));
  const accounts = await tx.account.findMany({
    where: { organizationId: input.organizationId, id: { in: accountIds }, isActive: true },
    select: { id: true },
  });
  if (accounts.length !== accountIds.length) {
    return { success: false, error: 'One or more selected accounts do not exist or are inactive in this organization.' };
  }

  let totalDebit = new Prisma.Decimal(0);
  let totalCredit = new Prisma.Decimal(0);
  const normalizedLines: Array<{
    accountId: string;
    description: string | null;
    debit: Prisma.Decimal;
    credit: Prisma.Decimal;
  }> = [];

  for (const line of input.lines) {
    const debit = roundMoney(line.debit);
    const credit = roundMoney(line.credit);
    if (debit.lt(0) || credit.lt(0)) {
      return { success: false, error: 'Debit and credit amounts cannot be negative.' };
    }
    if ((debit.gt(0) && credit.gt(0)) || (debit.eq(0) && credit.eq(0))) {
      return { success: false, error: 'Each journal line must have either a positive debit or a positive credit.' };
    }
    totalDebit = totalDebit.plus(debit);
    totalCredit = totalCredit.plus(credit);
    normalizedLines.push({
      accountId: line.accountId,
      description: line.description ?? null,
      debit,
      credit,
    });
  }

  if (input.postImmediately) {
    if (!totalDebit.equals(totalCredit) || totalDebit.lte(0)) {
      return {
        success: false,
        error: `Posted journal entries must balance: Debits (${totalDebit.toFixed(2)}) != Credits (${totalCredit.toFixed(2)}).`,
      };
    }
  }

  const entryNumber = generateEntryNumber();
  const now = new Date();
  const entry = await tx.journalEntry.create({
    data: {
      organizationId: input.organizationId,
      entryNumber,
      entryDate: input.entryDate,
      description: input.description,
      reference: input.reference ?? null,
      sourceType: input.sourceType ?? 'MANUAL',
      sourceId: input.sourceId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      status: input.postImmediately ? 'POSTED' : 'DRAFT',
      createdById: input.actorUserId ?? null,
      approvedById: input.postImmediately ? (input.actorUserId ?? null) : null,
      postedAt: input.postImmediately ? now : null,
      lines: { create: normalizedLines },
    },
  });

  if (input.actorUserId) {
    await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        targetType: 'JOURNAL_ENTRY',
        targetId: entry.id,
        action: input.postImmediately ? 'JOURNAL_POSTED' : 'JOURNAL_DRAFT_CREATED',
        after: {
          entryNumber: entry.entryNumber,
          status: entry.status,
          totalDebit: totalDebit.toFixed(2),
          totalCredit: totalCredit.toFixed(2),
        },
      },
      tx,
    );
  }

  return { success: true, data: { id: entry.id, entryNumber: entry.entryNumber } };
}

export async function createJournalEntry(input: CreateJournalEntryInput) {
  return prisma.$transaction((tx) => createJournalEntryInTx(tx, input));
}

export async function postDraftJournalEntry(input: {
  organizationId: string;
  journalEntryId: string;
  actorUserId: string;
}): Promise<ActionResult<{ id: string }>> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "JournalEntry" WHERE id = ${input.journalEntryId} AND "organizationId" = ${input.organizationId} FOR UPDATE`;
    const entry = await tx.journalEntry.findFirst({
      where: { id: input.journalEntryId, organizationId: input.organizationId },
      include: { lines: true },
    });
    if (!entry) return { success: false, error: 'Journal entry not found.' };
    if (entry.status !== 'DRAFT') {
      return { success: false, error: `Only DRAFT entries can be posted (current: ${entry.status}).` };
    }
    if (entry.lines.length < 2) {
      return { success: false, error: 'A journal entry requires at least two lines.' };
    }

    const totalDebit = entry.lines.reduce((s, l) => s.plus(l.debit), new Prisma.Decimal(0));
    const totalCredit = entry.lines.reduce((s, l) => s.plus(l.credit), new Prisma.Decimal(0));
    if (!totalDebit.equals(totalCredit) || totalDebit.lte(0)) {
      return {
        success: false,
        error: `Cannot post unbalanced journal entry: Debits (${totalDebit.toFixed(2)}) != Credits (${totalCredit.toFixed(2)}).`,
      };
    }

    await tx.journalEntry.update({
      where: { id: entry.id },
      data: { status: 'POSTED', approvedById: input.actorUserId, postedAt: new Date() },
    });

    await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        targetType: 'JOURNAL_ENTRY',
        targetId: entry.id,
        action: 'JOURNAL_POSTED',
        before: { status: 'DRAFT' },
        after: { status: 'POSTED', totalDebit: totalDebit.toFixed(2) },
      },
      tx,
    );

    return { success: true, data: { id: entry.id } };
  });
}

export async function reverseJournalEntry(input: {
  organizationId: string;
  journalEntryId: string;
  actorUserId: string;
  reason?: string;
}): Promise<ActionResult<{ reversalId: string; entryNumber: string }>> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "JournalEntry" WHERE id = ${input.journalEntryId} AND "organizationId" = ${input.organizationId} FOR UPDATE`;
    const original = await tx.journalEntry.findFirst({
      where: { id: input.journalEntryId, organizationId: input.organizationId },
      include: { lines: true },
    });
    if (!original) return { success: false, error: 'Journal entry not found.' };
    if (original.status !== 'POSTED') {
      return { success: false, error: 'Only POSTED journal entries can be reversed.' };
    }

    const existingReversal = await tx.journalEntry.findFirst({
      where: { organizationId: input.organizationId, reversedEntryId: original.id },
      select: { id: true },
    });
    if (existingReversal) {
      return { success: false, error: 'This journal entry has already been reversed.' };
    }

    const reversalNumber = `${original.entryNumber}-REV`;
    const reversal = await tx.journalEntry.create({
      data: {
        organizationId: input.organizationId,
        entryNumber: reversalNumber,
        entryDate: new Date(),
        description: `Reversal of ${original.entryNumber}${input.reason ? `: ${input.reason}` : ''}`,
        reference: original.reference,
        sourceType: 'REVERSAL',
        sourceId: original.id,
        idempotencyKey: `REVERSAL:${original.id}`,
        status: 'POSTED',
        createdById: input.actorUserId,
        approvedById: input.actorUserId,
        postedAt: new Date(),
        reversedEntryId: original.id,
        lines: {
          create: original.lines.map((line) => ({
            accountId: line.accountId,
            description: line.description ? `Reversal: ${line.description}` : 'Reversal',
            debit: line.credit,
            credit: line.debit,
          })),
        },
      },
    });

    await tx.journalEntry.update({
      where: { id: original.id },
      data: { status: 'REVERSED' },
    });

    await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        targetType: 'JOURNAL_ENTRY',
        targetId: original.id,
        action: 'JOURNAL_REVERSED',
        before: { status: 'POSTED' },
        after: { status: 'REVERSED', reversalId: reversal.id, reversalNumber },
      },
      tx,
    );

    return { success: true, data: { reversalId: reversal.id, entryNumber: reversal.entryNumber } };
  });
}

// ============================================================================
// CENTRALIZED CROSS-MODULE ACCOUNTING INTEGRATION SERVICES
// ============================================================================

export async function postInvoiceIssuedJournal(
  tx: TxOrClient,
  input: {
    organizationId: string;
    invoiceId: string;
    invoiceNumber: string;
    subtotal: Prisma.Decimal | number;
    taxAmount: Prisma.Decimal | number;
    totalAmount: Prisma.Decimal | number;
    cogsAmount?: Prisma.Decimal | number;
    actorUserId?: string | null;
    entryDate?: Date;
  },
) {
  const accounts = await ensureDefaultChartOfAccounts(tx, input.organizationId);
  const ar = accounts.get('1100')!;
  const revenue = accounts.get('4000')!;
  const taxPayable = accounts.get('2200')!;
  const cogs = accounts.get('5000')!;
  const inventory = accounts.get('1200')!;

  const subtotal = roundMoney(input.subtotal);
  const taxAmount = roundMoney(input.taxAmount);
  const totalAmount = roundMoney(input.totalAmount);
  const cogsAmount = roundMoney(input.cogsAmount ?? 0);

  const lines: JournalLineInput[] = [
    { accountId: ar.id, description: `Receivable for ${input.invoiceNumber}`, debit: totalAmount, credit: 0 },
    { accountId: revenue.id, description: `Sales revenue for ${input.invoiceNumber}`, debit: 0, credit: subtotal },
  ];
  if (taxAmount.gt(0)) {
    lines.push({ accountId: taxPayable.id, description: `Sales tax for ${input.invoiceNumber}`, debit: 0, credit: taxAmount });
  }
  if (cogsAmount.gt(0)) {
    lines.push({ accountId: cogs.id, description: `COGS for ${input.invoiceNumber}`, debit: cogsAmount, credit: 0 });
    lines.push({ accountId: inventory.id, description: `Inventory issued for ${input.invoiceNumber}`, debit: 0, credit: cogsAmount });
  }

  return createJournalEntryInTx(tx, {
    organizationId: input.organizationId,
    entryDate: input.entryDate ?? new Date(),
    description: `Sales Invoice ${input.invoiceNumber} issued`,
    reference: input.invoiceNumber,
    sourceType: 'INVOICE',
    sourceId: input.invoiceId,
    idempotencyKey: `INVOICE_ISSUE:${input.invoiceId}`,
    postImmediately: true,
    actorUserId: input.actorUserId ?? null,
    lines,
  });
}

export async function postInvoicePaymentJournal(
  tx: TxOrClient,
  input: {
    organizationId: string;
    paymentId: string;
    invoiceNumber: string;
    amount: Prisma.Decimal | number;
    paymentMethod: string;
    actorUserId?: string | null;
    entryDate?: Date;
  },
) {
  const accounts = await ensureDefaultChartOfAccounts(tx, input.organizationId);
  const cashOrBank = input.paymentMethod === 'CASH' ? accounts.get('1000')! : accounts.get('1010')!;
  const ar = accounts.get('1100')!;
  const amount = roundMoney(input.amount);

  return createJournalEntryInTx(tx, {
    organizationId: input.organizationId,
    entryDate: input.entryDate ?? new Date(),
    description: `Payment received for ${input.invoiceNumber} (${input.paymentMethod})`,
    reference: input.invoiceNumber,
    sourceType: 'INVOICE_PAYMENT',
    sourceId: input.paymentId,
    idempotencyKey: `INVOICE_PAYMENT:${input.paymentId}`,
    postImmediately: true,
    actorUserId: input.actorUserId ?? null,
    lines: [
      { accountId: cashOrBank.id, description: `Receipt for ${input.invoiceNumber}`, debit: amount, credit: 0 },
      { accountId: ar.id, description: `Clear AR for ${input.invoiceNumber}`, debit: 0, credit: amount },
    ],
  });
}

export async function postGrnJournal(
  tx: TxOrClient,
  input: {
    organizationId: string;
    grnId: string;
    receiptNumber: string;
    poNumber: string;
    amount: Prisma.Decimal | number;
    actorUserId?: string | null;
    entryDate?: Date;
  },
) {
  const amount = roundMoney(input.amount);
  if (amount.lte(0)) return { success: true as const, data: undefined };
  const accounts = await ensureDefaultChartOfAccounts(tx, input.organizationId);
  const inventory = accounts.get('1200')!;
  const grni = accounts.get('2100')!;

  return createJournalEntryInTx(tx, {
    organizationId: input.organizationId,
    entryDate: input.entryDate ?? new Date(),
    description: `Goods Receipt ${input.receiptNumber} for PO ${input.poNumber}`,
    reference: input.receiptNumber,
    sourceType: 'GRN',
    sourceId: input.grnId,
    idempotencyKey: `GRN:${input.grnId}`,
    postImmediately: true,
    actorUserId: input.actorUserId ?? null,
    lines: [
      { accountId: inventory.id, description: `Inventory received (${input.receiptNumber})`, debit: amount, credit: 0 },
      { accountId: grni.id, description: `Accrued GRNI (${input.poNumber})`, debit: 0, credit: amount },
    ],
  });
}

export async function postSupplierBillJournal(
  tx: TxOrClient,
  input: {
    organizationId: string;
    billId: string;
    billNumber: string;
    amount: Prisma.Decimal | number;
    fromPurchaseOrder: boolean;
    actorUserId?: string | null;
    entryDate?: Date;
  },
) {
  const amount = roundMoney(input.amount);
  const accounts = await ensureDefaultChartOfAccounts(tx, input.organizationId);
  const debitAcc = input.fromPurchaseOrder ? accounts.get('2100')! : accounts.get('5200')!;
  const ap = accounts.get('2000')!;

  return createJournalEntryInTx(tx, {
    organizationId: input.organizationId,
    entryDate: input.entryDate ?? new Date(),
    description: `Supplier Bill ${input.billNumber}`,
    reference: input.billNumber,
    sourceType: 'SUPPLIER_BILL',
    sourceId: input.billId,
    idempotencyKey: `SUPPLIER_BILL:${input.billId}`,
    postImmediately: true,
    actorUserId: input.actorUserId ?? null,
    lines: [
      { accountId: debitAcc.id, description: `Bill ${input.billNumber}`, debit: amount, credit: 0 },
      { accountId: ap.id, description: `AP for ${input.billNumber}`, debit: 0, credit: amount },
    ],
  });
}

export async function postSupplierPaymentJournal(
  tx: TxOrClient,
  input: {
    organizationId: string;
    paymentId: string;
    billNumber: string;
    amount: Prisma.Decimal | number;
    paymentMethod: string;
    actorUserId?: string | null;
    entryDate?: Date;
  },
) {
  const amount = roundMoney(input.amount);
  const accounts = await ensureDefaultChartOfAccounts(tx, input.organizationId);
  const ap = accounts.get('2000')!;
  const cashOrBank = input.paymentMethod === 'CASH' ? accounts.get('1000')! : accounts.get('1010')!;

  return createJournalEntryInTx(tx, {
    organizationId: input.organizationId,
    entryDate: input.entryDate ?? new Date(),
    description: `Supplier payment for Bill ${input.billNumber}`,
    reference: input.billNumber,
    sourceType: 'SUPPLIER_PAYMENT',
    sourceId: input.paymentId,
    idempotencyKey: `SUPPLIER_PAYMENT:${input.paymentId}`,
    postImmediately: true,
    actorUserId: input.actorUserId ?? null,
    lines: [
      { accountId: ap.id, description: `Clear AP for ${input.billNumber}`, debit: amount, credit: 0 },
      { accountId: cashOrBank.id, description: `Paid ${input.billNumber}`, debit: 0, credit: amount },
    ],
  });
}

export async function postPayrollPaidJournal(
  tx: TxOrClient,
  input: {
    organizationId: string;
    sourceId: string;
    periodLabel: string;
    totalGross: Prisma.Decimal | number;
    totalDeductions: Prisma.Decimal | number;
    totalNet: Prisma.Decimal | number;
    actorUserId?: string | null;
    entryDate?: Date;
  },
) {
  const accounts = await ensureDefaultChartOfAccounts(tx, input.organizationId);
  const payrollExpense = accounts.get('5100')!;
  const payrollPayable = accounts.get('2300')!;
  const bank = accounts.get('1010')!;

  const gross = roundMoney(input.totalGross);
  const net = roundMoney(input.totalNet);
  const deductions = roundMoney(toDecimal(gross).minus(net));

  const lines: JournalLineInput[] = [
    { accountId: payrollExpense.id, description: `Gross payroll (${input.periodLabel})`, debit: gross, credit: 0 },
  ];
  if (net.gt(0)) {
    lines.push({ accountId: bank.id, description: `Net salary disbursement (${input.periodLabel})`, debit: 0, credit: net });
  }
  if (deductions.gt(0)) {
    lines.push({ accountId: payrollPayable.id, description: `Tax/PF/Loan deductions (${input.periodLabel})`, debit: 0, credit: deductions });
  }

  return createJournalEntryInTx(tx, {
    organizationId: input.organizationId,
    entryDate: input.entryDate ?? new Date(),
    description: `Payroll disbursement for ${input.periodLabel}`,
    reference: input.periodLabel,
    sourceType: 'PAYROLL',
    sourceId: input.sourceId,
    idempotencyKey: `PAYROLL_PAY:${input.sourceId}`,
    postImmediately: true,
    actorUserId: input.actorUserId ?? null,
    lines,
  });
}

export async function postProjectExpenseJournal(
  tx: TxOrClient,
  input: {
    organizationId: string;
    expenseId: string;
    projectName: string;
    category: string;
    amount: Prisma.Decimal | number;
    actorUserId?: string | null;
    entryDate?: Date;
  },
) {
  const accounts = await ensureDefaultChartOfAccounts(tx, input.organizationId);
  const expense = accounts.get('5200')!;
  const bank = accounts.get('1010')!;
  const amount = roundMoney(input.amount);

  return createJournalEntryInTx(tx, {
    organizationId: input.organizationId,
    entryDate: input.entryDate ?? new Date(),
    description: `Approved project expense (${input.projectName}: ${input.category})`,
    reference: input.projectName,
    sourceType: 'PROJECT_EXPENSE',
    sourceId: input.expenseId,
    idempotencyKey: `PROJECT_EXPENSE:${input.expenseId}`,
    postImmediately: true,
    actorUserId: input.actorUserId ?? null,
    lines: [
      { accountId: expense.id, description: `${input.projectName} - ${input.category}`, debit: amount, credit: 0 },
      { accountId: bank.id, description: `Expense payment`, debit: 0, credit: amount },
    ],
  });
}

export async function postCreditNoteJournal(
  tx: TxOrClient,
  input: {
    organizationId: string;
    creditNoteId: string;
    creditNoteNumber: string;
    amount: Prisma.Decimal | number;
    actorUserId?: string | null;
    entryDate?: Date;
  },
) {
  const accounts = await ensureDefaultChartOfAccounts(tx, input.organizationId);
  const returns = accounts.get('4100')!;
  const ar = accounts.get('1100')!;
  const amount = roundMoney(input.amount);

  return createJournalEntryInTx(tx, {
    organizationId: input.organizationId,
    entryDate: input.entryDate ?? new Date(),
    description: `Credit Note ${input.creditNoteNumber}`,
    reference: input.creditNoteNumber,
    sourceType: 'CREDIT_NOTE',
    sourceId: input.creditNoteId,
    idempotencyKey: `CREDIT_NOTE:${input.creditNoteId}`,
    postImmediately: true,
    actorUserId: input.actorUserId ?? null,
    lines: [
      { accountId: returns.id, description: `Credit note ${input.creditNoteNumber}`, debit: amount, credit: 0 },
      { accountId: ar.id, description: `Reduce AR (${input.creditNoteNumber})`, debit: 0, credit: amount },
    ],
  });
}

export async function postDebitNoteJournal(
  tx: TxOrClient,
  input: {
    organizationId: string;
    debitNoteId: string;
    debitNoteNumber: string;
    amount: Prisma.Decimal | number;
    actorUserId?: string | null;
    entryDate?: Date;
  },
) {
  const accounts = await ensureDefaultChartOfAccounts(tx, input.organizationId);
  const ap = accounts.get('2000')!;
  const inventory = accounts.get('1200')!;
  const amount = roundMoney(input.amount);

  return createJournalEntryInTx(tx, {
    organizationId: input.organizationId,
    entryDate: input.entryDate ?? new Date(),
    description: `Debit Note ${input.debitNoteNumber}`,
    reference: input.debitNoteNumber,
    sourceType: 'DEBIT_NOTE',
    sourceId: input.debitNoteId,
    idempotencyKey: `DEBIT_NOTE:${input.debitNoteId}`,
    postImmediately: true,
    actorUserId: input.actorUserId ?? null,
    lines: [
      { accountId: ap.id, description: `Reduce AP (${input.debitNoteNumber})`, debit: amount, credit: 0 },
      { accountId: inventory.id, description: `Purchase return (${input.debitNoteNumber})`, debit: 0, credit: amount },
    ],
  });
}
