'use server';

import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireModuleAccess } from '@/core/auth/module-guard';
import { hasPermission, type Permission } from '@/lib/permissions';
import {
  adjustStockPosting,
  consumeReservation,
  expireStaleReservations,
  releaseReservation,
  stockIn,
  stockOut,
  transferStock,
} from './service';
import { adjustStock, createProduct } from './model';
import type { ServiceResult } from './types';

function revalidateInventoryRoutes() {
  revalidatePath('/inventory/products');
  revalidatePath('/inventory/stock-ledger');
  revalidatePath('/inventory/reservations');
}

async function requireInventoryPermission(preferred: Permission, legacy?: Permission) {
  const tenant = await requireModuleAccess('inventory');
  if (!hasPermission(tenant.authorization, preferred) && !(legacy && hasPermission(tenant.authorization, legacy))) {
    redirect('/dashboard?error=unauthorized');
  }
  return tenant;
}

export async function createProductAction(formData: FormData) {
  const tenant = await requireInventoryPermission('inventory.create', 'inventory.manage');
  const sku = String(formData.get('sku') || '').trim();
  const name = String(formData.get('name') || '').trim();
  const unit = String(formData.get('unit') || 'pcs').trim();
  const costPrice = Number(formData.get('costPrice') || 0);
  const sellingPrice = Number(formData.get('sellingPrice') || 0);
  const initialStock = Number(formData.get('initialStock') || 0);

  if (!sku || !name) return;

  await createProduct({
    organizationId: tenant.organizationId,
    sku,
    name,
    unit,
    costPrice,
    sellingPrice,
    initialStock,
  });

  revalidateInventoryRoutes();
}

export async function stockInAction(formData: FormData): Promise<ServiceResult> {
  const tenant = await requireInventoryPermission('inventory.create', 'inventory.manage');
  const parsed = {
    productId: String(formData.get('productId') || ''),
    warehouseId: String(formData.get('warehouseId') || ''),
    quantity: Number(formData.get('quantity') || 0),
    referenceNumber: String(formData.get('referenceNumber') || ''),
    notes: String(formData.get('notes') || ''),
  };
  if (!parsed.productId || parsed.quantity <= 0) return { success: false, error: 'Product and quantity are required.' };
  const result = await stockIn({
    organizationId: tenant.organizationId,
    productId: parsed.productId,
    warehouseId: parsed.warehouseId,
    quantity: parsed.quantity,
    referenceType: 'STOCK_IN',
    referenceId: randomUUID(),
    referenceNumber: parsed.referenceNumber || null,
    createdById: tenant.userId,
    notes: parsed.notes || null,
  });
  if (!result.success) return { success: false, error: result.error };
  revalidateInventoryRoutes();
  return result;
}

export async function stockOutAction(formData: FormData): Promise<ServiceResult> {
  const tenant = await requireInventoryPermission('inventory.delete', 'inventory.adjust');
  const parsed = {
    productId: String(formData.get('productId') || ''),
    warehouseId: String(formData.get('warehouseId') || ''),
    quantity: Number(formData.get('quantity') || 0),
    notes: String(formData.get('notes') || ''),
  };
  if (!parsed.productId || parsed.quantity <= 0) return { success: false, error: 'Product and quantity are required.' };
  const result = await stockOut({
    organizationId: tenant.organizationId,
    productId: parsed.productId,
    warehouseId: parsed.warehouseId,
    quantity: parsed.quantity,
    referenceType: 'STOCK_OUT',
    referenceId: randomUUID(),
    createdById: tenant.userId,
    notes: parsed.notes || null,
  });
  if (!result.success) return { success: false, error: result.error };
  revalidateInventoryRoutes();
  return result;
}

export async function transferStockAction(formData: FormData): Promise<ServiceResult> {
  const tenant = await requireInventoryPermission('inventory.transfer');
  const parsed = {
    productId: String(formData.get('productId') || ''),
    fromWarehouseId: String(formData.get('fromWarehouseId') || ''),
    toWarehouseId: String(formData.get('toWarehouseId') || ''),
    quantity: Number(formData.get('quantity') || 0),
    notes: String(formData.get('notes') || ''),
  };
  if (!parsed.productId || !parsed.fromWarehouseId || !parsed.toWarehouseId || parsed.quantity <= 0) {
    return { success: false, error: 'Product, source and destination warehouses, and quantity are required.' };
  }
  const result = await transferStock({
    organizationId: tenant.organizationId,
    productId: parsed.productId,
    fromWarehouseId: parsed.fromWarehouseId,
    toWarehouseId: parsed.toWarehouseId,
    quantity: parsed.quantity,
    createdById: tenant.userId,
    notes: parsed.notes || null,
  });
  if (!result.success) return { success: false, error: result.error };
  revalidateInventoryRoutes();
  return result;
}

export async function adjustStockAction(formData: FormData): Promise<ServiceResult> {
  const tenant = await requireInventoryPermission('inventory.adjust');
  const parsed = {
    productId: String(formData.get('productId') || ''),
    warehouseId: String(formData.get('warehouseId') || ''),
    adjustmentType: String(formData.get('adjustmentType') || 'DECREASE').toUpperCase(),
    quantity: Number(formData.get('quantity') || 0),
    reason: String(formData.get('reason') || '').trim(),
  };
  const allowed = new Set(['INCREASE', 'DECREASE', 'DAMAGED', 'LOST', 'EXPIRED', 'COUNT_CORRECTION']);
  if (!parsed.productId || !allowed.has(parsed.adjustmentType)) {
    return { success: false, error: 'Select a valid adjustment type.' };
  }
  if (parsed.adjustmentType !== 'COUNT_CORRECTION' && parsed.quantity <= 0) {
    return { success: false, error: 'Adjustment quantity must be positive for this type.' };
  }
  const result = await adjustStock({
    organizationId: tenant.organizationId,
    productId: parsed.productId,
    warehouseId: parsed.warehouseId || undefined,
    adjustmentType: parsed.adjustmentType as Parameters<typeof adjustStockPosting>[0]['adjustmentType'],
    quantity: parsed.quantity,
    reason: parsed.reason || `Adjusted stock of product ${parsed.productId}`,
    actorUserId: tenant.userId,
  });
  if (!result.success) return { success: false, error: result.error ?? 'Adjustment failed.' };
  revalidateInventoryRoutes();
  return { success: true };
}

export async function releaseReservationAction(formData: FormData): Promise<ServiceResult> {
  const tenant = await requireInventoryPermission('inventory.release_reservation');
  const reservationId = String(formData.get('reservationId') || '');
  if (!reservationId) return { success: false, error: 'Reservation ID is required.' };
  const result = await releaseReservation(tenant.organizationId, reservationId, tenant.userId);
  if (!result.success) return { success: false, error: result.error };
  revalidateInventoryRoutes();
  return result;
}

export async function consumeReservationAction(formData: FormData): Promise<ServiceResult> {
  const tenant = await requireInventoryPermission('inventory.reserve');
  const reservationId = String(formData.get('reservationId') || '');
  if (!reservationId) return { success: false, error: 'Reservation ID is required.' };
  const result = await consumeReservation(tenant.organizationId, reservationId, tenant.userId);
  if (!result.success) return { success: false, error: result.error };
  revalidateInventoryRoutes();
  return result;
}

export async function expireStaleReservationsAction(): Promise<ServiceResult> {
  const tenant = await requireInventoryPermission('inventory.adjust');
  const count = await expireStaleReservations(tenant.organizationId);
  revalidateInventoryRoutes();
  return { success: true, data: { expiredCount: count } };
}
