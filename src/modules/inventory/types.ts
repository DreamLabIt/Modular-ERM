import { Prisma } from '@prisma/client';

export const STOCK_MOVEMENT_TYPES = [
  'OPENING_STOCK',
  'STOCK_IN',
  'STOCK_OUT',
  'SALES_DEDUCTION',
  'SALES_RETURN',
  'RESERVED',
  'RESERVATION_RELEASED',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'DAMAGED',
  'LOST',
  'EXPIRED',
  'PURCHASE_RECEIPT',
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_RESERVATION_STATUSES = [
  'ACTIVE',
  'RELEASED',
  'CONSUMED',
  'EXPIRED',
  'CANCELLED',
] as const;

export type StockReservationStatus = (typeof STOCK_RESERVATION_STATUSES)[number];

export const STOCK_ADJUSTMENT_TYPES = [
  'INCREASE',
  'DECREASE',
  'DAMAGED',
  'LOST',
  'EXPIRED',
  'COUNT_CORRECTION',
] as const;

export type StockAdjustmentType = (typeof STOCK_ADJUSTMENT_TYPES)[number];

export interface StockBalance {
  stockId: string | null;
  productId: string;
  warehouseId: string;
  /** Physical stock held in the warehouse. */
  physical: number;
  /** Stock reserved by ACTIVE reservations. */
  activeReserved: number;
  /** Physical stock available to sell or consume. */
  available: number;
}

export interface StockMovementFilters {
  productId?: string;
  warehouseId?: string;
  movementType?: StockMovementType;
  referenceType?: string;
  referenceId?: string;
  fromDate?: Date;
  toDate?: Date;
  organizationId?: string;
}

export interface StockReservationSummary {
  reservation: {
    id: string;
    productId: string;
    warehouseId: string;
    reservedQuantity: number;
    status: StockReservationStatus;
    referenceType: string;
    referenceId: string;
    referenceNumber: string | null;
    expiresAt: Date | null;
    createdAt: Date;
    createdById: string;
  };
  productName: string;
  productSku: string;
  warehouseName: string;
  releasedAt: Date | null;
  consumedAt: Date | null;
  expiredAt: Date | null;
  cancelledAt: Date | null;
}

export type ServiceResult<T = unknown> =
  | { success: true; data?: T }
  | { success: false; error: string };

export function formatQuantity(value: number): string {
  return new Prisma.Decimal(value).toFixed(2);
}
