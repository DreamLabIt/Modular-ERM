import { Prisma } from '@prisma/client';

export const INVOICE_STATUSES = [
  'DRAFT',
  'SENT',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CANCELLED',
] as const;

export const PAYMENT_METHODS = [
  'CASH',
  'BANK_TRANSFER',
  'CARD',
  'MOBILE_BANKING',
  'OTHER',
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function calculateOutstandingBalance(
  totalAmount: Prisma.Decimal | string | number,
  totalPaid: Prisma.Decimal | string | number,
) {
  const outstanding = new Prisma.Decimal(totalAmount).minus(new Prisma.Decimal(totalPaid));
  return outstanding.lessThanOrEqualTo(0) ? new Prisma.Decimal(0) : outstanding;
}

export function calculateTotalPaid(payments: Array<{ amount: Prisma.Decimal | string | number }>) {
  return payments.reduce(
    (sum, payment) => sum.plus(new Prisma.Decimal(payment.amount)),
    new Prisma.Decimal(0),
  );
}

export function getEffectiveInvoiceStatus(input: {
  status: string;
  dueDate: Date | null;
  totalAmount: Prisma.Decimal | string | number;
  totalPaid: Prisma.Decimal | string | number;
  now?: Date;
}) {
  if (input.status === 'DRAFT') return 'DRAFT';
  if (input.status === 'CANCELLED') return 'CANCELLED';
  if (input.status === 'PAID') return 'PAID';

  const outstanding = calculateOutstandingBalance(input.totalAmount, input.totalPaid);
  if (outstanding.equals(0)) return 'PAID';
  const now = input.now ?? new Date();
  if (
    input.dueDate &&
    input.status !== 'PAID' &&
    input.dueDate.getTime() < startOfDay(now).getTime()
  ) {
    return 'OVERDUE';
  }
  if (totalPaidGreaterThanZero(input.totalPaid)) return 'PARTIALLY_PAID';

  return 'SENT';
}

function totalPaidGreaterThanZero(totalPaid: Prisma.Decimal | string | number) {
  return new Prisma.Decimal(totalPaid).greaterThan(0);
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
}
