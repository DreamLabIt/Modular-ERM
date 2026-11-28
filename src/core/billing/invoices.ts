import { Prisma, PrismaClient, type Prisma as PrismaTypes } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { ValidationError, ConflictError } from '@/core/errors';
import { buildPdfDocument } from '@/shared/utils/pdf';
import { getOrganizationEntitlements } from './entitlements';
import { billingAudit } from './audit';
import { inTransaction } from './transaction';

type Db = Prisma.TransactionClient | PrismaClient;

export interface InvoiceItemInput {
  description: string;
  itemType: string;
  referenceId?: string;
  quantity?: number;
  unitAmount: string | number;
}

async function nextInvoiceNumber(db: Db): Promise<string> {
  const rows = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "PlatformSetting" ("key", "value", "updatedAt")
    VALUES ('billing_invoice_counter', '{"value":1}'::jsonb, NOW())
    ON CONFLICT ("key")
    DO UPDATE SET "value" = jsonb_build_object('value', COALESCE(("PlatformSetting"."value"->>'value')::int, 0) + 1), "updatedAt" = NOW()
    RETURNING ("value"->>'value')::int AS value
  `;
  const sequence = rows[0]?.value ?? 1;
  const year = new Date().getUTCFullYear();
  return `BIL-${year}-${String(sequence).padStart(6, '0')}`;
}

function decimal(value: string | number): Prisma.Decimal {
  const parsed = new Prisma.Decimal(value.toString());
  if (parsed.isNegative()) throw new ValidationError('Monetary amounts cannot be negative.');
  return parsed;
}

export async function generateInvoice(input: {
  organizationId: string;
  subscriptionId?: string | null;
  items: InvoiceItemInput[];
  currency?: string;
  discount?: string | number;
  taxRate?: string | number;
  dueInDays?: number;
  description?: string;
  billingPeriodStart?: Date;
  billingPeriodEnd?: Date;
  metadata?: Record<string, unknown>;
  actorUserId?: string;
  actorEmail?: string;
  db?: Db;
}) {
  const db = input.db ?? prisma;
  if (input.items.length === 0) throw new ValidationError('An invoice needs at least one line item.');

  return inTransaction(db, async (tx) => {
    const entitlements = await getOrganizationEntitlements(input.organizationId);
    const currency = input.currency ?? entitlements.currency ?? 'BDT';
    const invoiceNumber = await nextInvoiceNumber(tx);
    const dueDate = new Date(Date.now() + Math.max(1, input.dueInDays ?? 14) * 24 * 60 * 60 * 1000);
    const discount = decimal(input.discount ?? 0);
    const taxRate = decimal(input.taxRate ?? 0);
    if (taxRate.greaterThan(100)) throw new ValidationError('Tax rate cannot exceed 100%.');

    const itemData = input.items.map((item) => {
      const quantity = Math.max(1, Math.trunc(item.quantity ?? 1));
      const unitAmount = decimal(item.unitAmount);
      return {
        description: item.description.slice(0, 300),
        itemType: item.itemType,
        referenceId: item.referenceId ?? null,
        quantity,
        unitAmount,
        amount: unitAmount.mul(quantity),
      };
    });
    const subtotal = itemData.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
    if (discount.greaterThan(subtotal)) throw new ValidationError('Discount cannot exceed the invoice subtotal.');
    const taxable = subtotal.minus(discount);
    const taxAmount = taxable.mul(taxRate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const totalAmount = taxable.plus(taxAmount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    const invoice = await tx.billingInvoice.create({
      data: {
        organizationId: input.organizationId,
        subscriptionId: input.subscriptionId ?? null,
        invoiceNumber,
        status: 'DRAFT',
        currency,
        billingPeriodStart: input.billingPeriodStart,
        billingPeriodEnd: input.billingPeriodEnd,
        description: input.description?.slice(0, 500) ?? null,
        subtotal,
        discountAmount: discount,
        taxRate,
        taxAmount,
        totalAmount,
        dueDate,
        metadata: input.metadata as PrismaTypes.InputJsonValue | undefined,
        items: { create: itemData },
      },
      include: { items: true },
    });
    await billingAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail,
      action: 'INVOICE_GENERATED',
      resource: 'BILLING_INVOICE',
      resourceId: invoice.id,
      metadata: { invoiceNumber, total: totalAmount.toString() },
      db: tx,
    });
    return invoice;
  });
}

/** Finalization makes invoice amounts immutable. Corrections require credit notes. */
export async function finalizeInvoice(input: {
  organizationId: string;
  invoiceId: string;
  actorUserId?: string;
  actorEmail?: string;
  db?: Db;
}) {
  const db = input.db ?? prisma;
  return inTransaction(db, async (tx) => {
    const invoice = await tx.billingInvoice.findFirst({
      where: { id: input.invoiceId, organizationId: input.organizationId },
    });
    if (!invoice) throw new ValidationError('Invoice not found.');
    if (invoice.finalizedAt) return invoice;
    if (['VOID', 'REFUNDED'].includes(invoice.status)) {
      throw new ValidationError('A voided or refunded invoice cannot be finalized.');
    }
    const updated = await tx.billingInvoice.update({
      where: { id: invoice.id },
      data: { status: 'PENDING', finalizedAt: new Date() },
    });
    await billingAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail,
      action: 'INVOICE_FINALIZED',
      resource: 'BILLING_INVOICE',
      resourceId: invoice.id,
      db: tx,
    });
    return updated;
  });
}

export async function voidInvoice(input: {
  organizationId: string;
  invoiceId: string;
  reason: string;
  actorUserId?: string;
  actorEmail?: string;
}) {
  if (!input.reason.trim()) throw new ValidationError('A void reason is required.');
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.billingInvoice.findFirst({
      where: { id: input.invoiceId, organizationId: input.organizationId },
    });
    if (!invoice) throw new ValidationError('Invoice not found.');
    if (invoice.status === 'PAID' || invoice.status === 'PARTIALLY_PAID') {
      throw new ValidationError('Paid invoices cannot be voided; use a credit/adjustment record.');
    }
    const updated = await tx.billingInvoice.update({
      where: { id: invoice.id },
      data: { status: 'VOID', voidedAt: new Date(), metadata: { voidReason: input.reason } as PrismaTypes.InputJsonValue },
    });
    await billingAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail,
      action: 'INVOICE_VOIDED',
      resource: 'BILLING_INVOICE',
      resourceId: invoice.id,
      db: tx,
    });
    return updated;
  });
}

/** Applies a verified payment to a finalized invoice, safely handling partials. */
export async function settleInvoice(input: {
  organizationId: string;
  invoiceId: string;
  amount: string | number;
  paidAt?: Date;
  db: Db;
}) {
  const amount = decimal(input.amount);
  if (amount.lessThanOrEqualTo(0)) throw new ValidationError('Payment amount must be positive.');
  const invoice = await input.db.billingInvoice.findFirst({
    where: { id: input.invoiceId, organizationId: input.organizationId },
  });
  if (!invoice) throw new ValidationError('Invoice not found.');
  if (!invoice.finalizedAt) throw new ValidationError('Only finalized invoices can be settled.');
  if (['VOID', 'REFUNDED'].includes(invoice.status)) throw new ValidationError('This invoice cannot be settled.');

  const amountPaid = new Prisma.Decimal(invoice.amountPaid).plus(amount);
  if (amountPaid.greaterThan(invoice.totalAmount)) {
    throw new ValidationError('Payment exceeds the outstanding invoice amount.');
  }
  const fullyPaid = amountPaid.greaterThanOrEqualTo(invoice.totalAmount);
  return input.db.billingInvoice.update({
    where: { id: invoice.id },
    data: {
      amountPaid,
      status: fullyPaid ? 'PAID' : 'PARTIALLY_PAID',
      paidAt: fullyPaid ? (input.paidAt ?? new Date()) : null,
    },
  });
}

export async function getInvoiceForOrganization(organizationId: string, invoiceId: string) {
  const invoice = await prisma.billingInvoice.findFirst({
    where: { id: invoiceId, organizationId },
    include: { items: true, payments: { orderBy: { createdAt: 'desc' } } },
  });
  if (!invoice) throw new ValidationError('Invoice not found.');
  return invoice;
}

export async function listInvoicesForOrganization(organizationId: string, take = 100) {
  return prisma.billingInvoice.findMany({
    where: { organizationId },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

export async function listAllInvoices(take = 100) {
  return prisma.billingInvoice.findMany({
    include: { organization: { select: { name: true, slug: true } } },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

export async function markOverdueInvoices() {
  return prisma.billingInvoice.updateMany({
    where: {
      status: { in: ['PENDING', 'PARTIALLY_PAID'] },
      dueDate: { lt: new Date() },
    },
    data: { status: 'OVERDUE' },
  });
}

export function buildInvoicePdf(invoice: Awaited<ReturnType<typeof getInvoiceForOrganization>>, organizationName: string) {
  return buildPdfDocument({
    title: `Invoice ${invoice.invoiceNumber}`,
    subtitle: organizationName,
    metadata: [
      `Status: ${invoice.status}`,
      `Issue date: ${invoice.issueDate.toISOString().slice(0, 10)}`,
      `Due date: ${invoice.dueDate.toISOString().slice(0, 10)}`,
      `Currency: ${invoice.currency}`,
    ],
    sections: [
      {
        heading: 'Line items',
        lines: invoice.items.map(
          (item) =>
            `${item.quantity} × ${item.description} — ${item.unitAmount.toString()} = ${item.amount.toString()}`,
        ),
      },
      {
        heading: 'Totals',
        lines: [
          `Subtotal: ${invoice.subtotal.toString()}`,
          `Discount: ${invoice.discountAmount.toString()}`,
          `Tax (${invoice.taxRate.toString()}%): ${invoice.taxAmount.toString()}`,
          `Total: ${invoice.totalAmount.toString()}`,
          `Paid: ${invoice.amountPaid.toString()}`,
        ],
      },
    ],
  });
}
