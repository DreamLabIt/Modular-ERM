import { Prisma } from '@prisma/client';

export const INVOICE_STATUSES = [
  'DRAFT',
  'SENT',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CANCELLED',
] as const;

// Purchase Order lifecycle:
//   DRAFT -> PENDING_APPROVAL -> APPROVED -> SENT -> PARTIALLY_RECEIVED -> RECEIVED
// Additional terminal states: REJECTED, CANCELLED
// Stock is never increased by PO creation, approval or sending. It increases
// only when a valid GoodsReceipt is recorded.
export const PURCHASE_ORDER_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SENT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'REJECTED',
  'CANCELLED',
] as const;

export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED: 'Approved',
  SENT: 'Sent to Supplier',
  PARTIALLY_RECEIVED: 'Partially Received',
  RECEIVED: 'Received',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export function isPurchaseOrderStatus(value: string): value is PurchaseOrderStatus {
  return PURCHASE_ORDER_STATUSES.some((status) => status === value);
}

// Server-side enforced lifecycle. RECEIVED, REJECTED and CANCELLED are terminal.
export const PURCHASE_ORDER_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  SENT: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['PARTIALLY_RECEIVED', 'RECEIVED'],
  RECEIVED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function isValidPurchaseOrderTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
  if (from === to) {
    // PARTIALLY_RECEIVED -> PARTIALLY_RECEIVED is allowed (more goods received later).
    return from === 'PARTIALLY_RECEIVED';
  }
  return PURCHASE_ORDER_TRANSITIONS[from].includes(to);
}

// Stock increases only after GRNs. A PO is fully received when every item has
// been accepted up to its ordered quantity.
export function isPurchaseOrderFullyReceived(
  orderedQuantity: number,
  previouslyReceived: number,
): boolean {
  return previouslyReceived >= orderedQuantity;
}

export function calculateRemainingQuantity(orderedQuantity: number, previouslyReceived: number): number {
  return Math.max(0, orderedQuantity - previouslyReceived);
}

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
