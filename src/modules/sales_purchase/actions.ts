'use server';

import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireModuleAccess } from '@/core/auth/module-guard';
import { hasPermission, type Permission } from '@/lib/permissions';
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createGoodsReceipt,
  rejectPurchaseOrder,
  sendPurchaseOrder,
  submitPurchaseOrderForApproval,
} from './service';
import {
  cancelInvoice,
  createInvoice,
  createPurchaseOrder,
  createSupplier,
  deleteDraftInvoice,
  editPurchaseOrderDraft,
  issueInvoice,
  recordInvoicePayment,
  updateDraftInvoice,
} from './model';
import type { CreatePurchaseOrderInput, GoodsReceiptInputItem } from '@/core/types';

async function requirePurchaseOrderPermission(preferred: Permission, legacy?: Permission) {
  const tenant = await requireModuleAccess('sales_purchase');
  if (
    !hasPermission(tenant.authorization, preferred) &&
    !(legacy && hasPermission(tenant.authorization, legacy))
  ) {
    redirect('/dashboard?error=unauthorized');
  }
  return tenant;
}

type ActionResult =
  | { success: true; message?: string; data?: { id: string; poNumber?: string; receiptNumber?: string } }
  | { success: false; error: string };

function revalidatePurchaseRoutes() {
  revalidatePath('/sales-purchase/purchases');
  revalidatePath('/sales-purchase/receipts');
  revalidatePath('/inventory/products');
  revalidatePath('/accounting');
  revalidatePath('/dashboard');
  revalidatePath('/reports');
}

const createSchema = z.object({
  customerId: z.string().cuid(),
  productId: z.string().cuid(),
  quantity: z.coerce.number().int().positive(),
  taxPercent: z.coerce.number().min(0).max(100),
  dueDate: z.string().optional(),
});

const purchaseOrderItemInput = z.object({
  productId: z.string().cuid(),
  quantity: z.coerce.number().int().positive(),
  notes: z.string().trim().max(500).optional(),
});

const createPurchaseOrderSchema = z.object({
  supplierId: z.string().cuid(),
  warehouseId: z.string().cuid(),
  expectedDate: z.string().trim().optional(),
  items: z.string().min(1),
});

function parsePurchaseOrderItems(raw: string): CreatePurchaseOrderInput['items'] {
  const parsed = z.array(purchaseOrderItemInput).min(1).parse(JSON.parse(raw));
  return parsed.map((item) => ({ productId: item.productId, quantity: item.quantity, notes: item.notes }));
}

export async function createPurchaseOrderAction(formData: FormData): Promise<ActionResult> {
  const tenant = await requirePurchaseOrderPermission('sales_purchase.po.create', 'sales_purchase.manage');
  const parsed = createPurchaseOrderSchema.safeParse({
    supplierId: String(formData.get('supplierId') || ''),
    warehouseId: String(formData.get('warehouseId') || ''),
    expectedDate: String(formData.get('expectedDate') || ''),
    items: String(formData.get('items') || ''),
  });
  if (!parsed.success) {
    return { success: false, error: 'Enter a supplier, warehouse, and at least one product with a positive quantity.' };
  }
  let expectedDate: Date | undefined;
  const expectedDateRaw = parsed.data.expectedDate?.trim();
  if (expectedDateRaw) {
    expectedDate = new Date(`${expectedDateRaw}T00:00:00.000Z`);
    if (Number.isNaN(expectedDate.getTime())) {
      return { success: false, error: 'Expected delivery date is invalid.' };
    }
  }

  let items: CreatePurchaseOrderInput['items'];
  try {
    items = parsePurchaseOrderItems(parsed.data.items);
  } catch {
    return { success: false, error: 'Enter at least one product with a positive quantity.' };
  }

  const result = await createPurchaseOrder({
    organizationId: tenant.organizationId,
    supplierId: parsed.data.supplierId,
    warehouseId: parsed.data.warehouseId,
    expectedDate,
    actorUserId: tenant.userId,
    items,
  });
  if (!result.success) return { success: false, error: result.error };
  revalidatePurchaseRoutes();
  return { success: true, data: { id: result.data.id, poNumber: result.data.poNumber } };
}

export async function editPurchaseOrderAction(formData: FormData): Promise<ActionResult> {
  const tenant = await requirePurchaseOrderPermission('sales_purchase.po.edit');
  const parsed = createPurchaseOrderSchema.extend({
    purchaseOrderId: z.string().cuid(),
  }).safeParse({
    purchaseOrderId: String(formData.get('purchaseOrderId') || ''),
    supplierId: String(formData.get('supplierId') || ''),
    warehouseId: String(formData.get('warehouseId') || ''),
    expectedDate: String(formData.get('expectedDate') || ''),
    items: String(formData.get('items') || ''),
  });
  if (!parsed.success) {
    return { success: false, error: 'Enter a supplier, warehouse, and at least one product with a positive quantity.' };
  }
  let expectedDate: Date | undefined;
  const expectedDateRaw = parsed.data.expectedDate?.trim();
  if (expectedDateRaw) {
    expectedDate = new Date(`${expectedDateRaw}T00:00:00.000Z`);
    if (Number.isNaN(expectedDate.getTime())) {
      return { success: false, error: 'Expected delivery date is invalid.' };
    }
  }
  let items: CreatePurchaseOrderInput['items'];
  try {
    items = parsePurchaseOrderItems(parsed.data.items);
  } catch {
    return { success: false, error: 'Enter at least one product with a positive quantity.' };
  }
  const result = await editPurchaseOrderDraft({
    organizationId: tenant.organizationId,
    purchaseOrderId: parsed.data.purchaseOrderId,
    supplierId: parsed.data.supplierId,
    warehouseId: parsed.data.warehouseId,
    expectedDate: expectedDate ?? null,
    actorUserId: tenant.userId,
    items,
  });
  if (!result.success) return { success: false, error: result.error };
  revalidatePurchaseRoutes();
  return { success: true, data: result.data };
}

export async function submitPurchaseOrderForApprovalAction(purchaseOrderId: string): Promise<ActionResult> {
  const tenant = await requirePurchaseOrderPermission('sales_purchase.po.submit');
  const parsed = z.string().cuid().safeParse(purchaseOrderId);
  if (!parsed.success) return { success: false, error: 'Invalid Purchase Order.' };
  const result = await submitPurchaseOrderForApproval({
    organizationId: tenant.organizationId,
    purchaseOrderId: parsed.data,
    actorUserId: tenant.userId,
  });
  if (!result.success) return { success: false, error: result.error };
  revalidatePurchaseRoutes();
  return { success: true, data: result.data };
}

export async function approvePurchaseOrderAction(purchaseOrderId: string): Promise<ActionResult> {
  const tenant = await requirePurchaseOrderPermission('sales_purchase.po.approve');
  const parsed = z.string().cuid().safeParse(purchaseOrderId);
  if (!parsed.success) return { success: false, error: 'Invalid Purchase Order.' };
  const result = await approvePurchaseOrder({
    organizationId: tenant.organizationId,
    purchaseOrderId: parsed.data,
    actorUserId: tenant.userId,
  });
  if (!result.success) return { success: false, error: result.error };
  revalidatePurchaseRoutes();
  return { success: true, data: result.data };
}

export async function rejectPurchaseOrderAction(purchaseOrderId: string, reason: string): Promise<ActionResult> {
  const tenant = await requirePurchaseOrderPermission('sales_purchase.po.reject');
  const parsed = z.object({ id: z.string().cuid(), reason: z.string().trim().max(500) }).safeParse({
    id: purchaseOrderId,
    reason,
  });
  if (!parsed.success) return { success: false, error: 'Invalid Purchase Order or rejection reason.' };
  const result = await rejectPurchaseOrder({
    organizationId: tenant.organizationId,
    purchaseOrderId: parsed.data.id,
    actorUserId: tenant.userId,
    reason: parsed.data.reason,
  });
  if (!result.success) return { success: false, error: result.error };
  revalidatePurchaseRoutes();
  return { success: true, data: result.data };
}

export async function sendPurchaseOrderAction(purchaseOrderId: string): Promise<ActionResult> {
  const tenant = await requirePurchaseOrderPermission('sales_purchase.po.send');
  const parsed = z.string().cuid().safeParse(purchaseOrderId);
  if (!parsed.success) return { success: false, error: 'Invalid Purchase Order.' };
  const result = await sendPurchaseOrder({
    organizationId: tenant.organizationId,
    purchaseOrderId: parsed.data,
    actorUserId: tenant.userId,
  });
  if (!result.success) return { success: false, error: result.error };
  revalidatePurchaseRoutes();
  return { success: true, data: result.data };
}

export async function cancelPurchaseOrderAction(purchaseOrderId: string, reason: string): Promise<ActionResult> {
  const tenant = await requirePurchaseOrderPermission('sales_purchase.po.cancel');
  const parsed = z.object({ id: z.string().cuid(), reason: z.string().trim().max(500) }).safeParse({
    id: purchaseOrderId,
    reason,
  });
  if (!parsed.success) return { success: false, error: 'Invalid Purchase Order or cancellation reason.' };
  const result = await cancelPurchaseOrder({
    organizationId: tenant.organizationId,
    purchaseOrderId: parsed.data.id,
    actorUserId: tenant.userId,
    reason: parsed.data.reason,
  });
  if (!result.success) return { success: false, error: result.error };
  revalidatePurchaseRoutes();
  return { success: true, data: result.data };
}

export async function createGoodsReceiptAction(formData: FormData): Promise<ActionResult> {
  const tenant = await requireModuleAccess('sales_purchase', 'sales_purchase.grn.create');
  const parsed = z.object({
    purchaseOrderId: z.string().cuid(),
    warehouseId: z.string().cuid(),
    receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z.string().trim().max(1000).optional(),
    idempotencyKey: z.string().trim().max(100).optional(),
    items: z.string().min(1),
  }).safeParse({
    purchaseOrderId: String(formData.get('purchaseOrderId') || ''),
    warehouseId: String(formData.get('warehouseId') || ''),
    receivedDate: String(formData.get('receivedDate') || ''),
    notes: String(formData.get('notes') || ''),
    idempotencyKey: String(formData.get('idempotencyKey') || ''),
    items: String(formData.get('items') || ''),
  });
  if (!parsed.success) {
    return { success: false, error: 'Enter a valid receipt, warehouse, and receipt lines.' };
  }

  const receivedDateRaw = parsed.data.receivedDate?.trim();
  const receivedDate = receivedDateRaw
    ? new Date(`${receivedDateRaw}T00:00:00.000Z`)
    : new Date();
  if (Number.isNaN(receivedDate.getTime())) {
    return { success: false, error: 'Received date is invalid.' };
  }

  let items: GoodsReceiptInputItem[];
  try {
    items = JSON.parse(parsed.data.items) as GoodsReceiptInputItem[];
  } catch {
    return { success: false, error: 'Invalid receipt lines.' };
  }

  const result = await createGoodsReceipt({
    organizationId: tenant.organizationId,
    purchaseOrderId: parsed.data.purchaseOrderId,
    warehouseId: parsed.data.warehouseId,
    receivedById: tenant.userId,
    receivedDate,
    notes: parsed.data.notes,
    idempotencyKey: parsed.data.idempotencyKey || randomUUID(),
    enabledModules: tenant.enabledModules,
    items,
  });
  if (!result.success) return { success: false, error: result.error };
  if ('duplicate' in result && result.duplicate) {
    return { success: true, message: 'This receipt was already recorded.', data: { id: result.receiptId } };
  }
  revalidatePurchaseRoutes();
  return { success: true, data: { id: result.receiptId, poNumber: undefined } };
}

export async function createSupplierAction(formData: FormData) {
  const tenant = await requireModuleAccess('sales_purchase', 'sales_purchase.manage');
  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  if (!name) return;
  await createSupplier({ organizationId: tenant.organizationId, name, email, phone });
  revalidatePath('/sales-purchase/purchases');
}

export type { ActionResult };
async function requireInvoicePermission(
  preferred: Permission,
  legacy: Permission,
) {
  const tenant = await requireModuleAccess('sales_purchase');
  if (
    !hasPermission(tenant.authorization, preferred) &&
    !hasPermission(tenant.authorization, legacy)
  ) {
    redirect('/dashboard?error=unauthorized');
  }
  return tenant;
}
export async function createInvoiceAction(formData: FormData) {
  const tenant = await requireInvoicePermission(
    'sales_purchase.invoice.create',
    'sales_purchase.manage',
  );
  const parsed = createSchema.safeParse({
    customerId: String(formData.get('customerId') || ''),
    productId: String(formData.get('productId') || ''),
    quantity: formData.get('quantity'),
    taxPercent: formData.get('taxPercent') ?? 0,
    dueDate: String(formData.get('dueDate') || ''),
  });
  if (!parsed.success) return;

  const dueDate = parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T00:00:00.000Z`) : undefined;
  if (dueDate && Number.isNaN(dueDate.getTime())) {
    return;
  }

  const result = await createInvoice({
    organizationId: tenant.organizationId,
    customerId: parsed.data.customerId,
    productId: parsed.data.productId,
    quantity: parsed.data.quantity,
    taxPercent: parsed.data.taxPercent,
    dueDate,
    enabledModules: tenant.enabledModules,
  });
  revalidateInvoiceRoutes();
  void result;
}

export async function updateDraftInvoiceAction(formData: FormData) {
  const tenant = await requireInvoicePermission(
    'sales_purchase.invoice.edit',
    'sales_purchase.manage',
  );
  const parsed = createSchema.extend({ invoiceId: z.string().cuid() }).safeParse({
    invoiceId: String(formData.get('invoiceId') || ''),
    customerId: String(formData.get('customerId') || ''),
    productId: String(formData.get('productId') || ''),
    quantity: formData.get('quantity'),
    taxPercent: formData.get('taxPercent') ?? 0,
    dueDate: String(formData.get('dueDate') || ''),
  });
  if (!parsed.success) return;
  const dueDate = parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T00:00:00.000Z`) : undefined;
  const result = await updateDraftInvoice({
    organizationId: tenant.organizationId,
    invoiceId: parsed.data.invoiceId,
    customerId: parsed.data.customerId,
    productId: parsed.data.productId,
    quantity: parsed.data.quantity,
    taxPercent: parsed.data.taxPercent,
    dueDate,
  });
  revalidateInvoiceRoutes();
  void result;
}

export async function deleteDraftInvoiceAction(formData: FormData) {
  const tenant = await requireInvoicePermission(
    'sales_purchase.invoice.edit',
    'sales_purchase.manage',
  );
  const invoiceId = z.string().cuid().safeParse(formData.get('invoiceId'));
  if (!invoiceId.success) return;
  const result = await deleteDraftInvoice(tenant.organizationId, invoiceId.data);
  revalidateInvoiceRoutes();
  void result;
}

export async function issueInvoiceAction(formData: FormData) {
  const tenant = await requireInvoicePermission(
    'sales_purchase.invoice.issue',
    'sales_purchase.manage',
  );
  const parsed = z.object({
    invoiceId: z.string().cuid(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).safeParse({
    invoiceId: String(formData.get('invoiceId') || ''),
    dueDate: String(formData.get('dueDate') || ''),
  });
  if (!parsed.success) return;
  const dueDate = new Date(`${parsed.data.dueDate}T00:00:00.000Z`);
  const result = await issueInvoice({
    organizationId: tenant.organizationId,
    invoiceId: parsed.data.invoiceId,
    dueDate,
    enabledModules: tenant.enabledModules,
  });
  revalidateInvoiceRoutes();
  void result;
}

export async function recordInvoicePaymentAction(formData: FormData) {
  const tenant = await requireInvoicePermission(
    'sales_purchase.invoice.payment.record',
    'sales_purchase.manage',
  );
  const parsed = z.object({
    invoiceId: z.string().cuid(),
    amount: z.coerce.number().positive(),
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'MOBILE_BANKING', 'OTHER']),
    referenceNumber: z.string().max(100).optional(),
    notes: z.string().max(1000).optional(),
    idempotencyKey: z.string().max(100).optional(),
  }).safeParse({
    invoiceId: String(formData.get('invoiceId') || ''),
    amount: formData.get('amount'),
    paymentDate: String(formData.get('paymentDate') || ''),
    paymentMethod: String(formData.get('paymentMethod') || ''),
    referenceNumber: String(formData.get('referenceNumber') || ''),
    notes: String(formData.get('notes') || ''),
    idempotencyKey: String(formData.get('idempotencyKey') || ''),
  });
  if (!parsed.success) return;

  const result = await recordInvoicePayment({
    organizationId: tenant.organizationId,
    invoiceId: parsed.data.invoiceId,
    receivedById: tenant.userId,
    amount: parsed.data.amount,
    paymentDate: new Date(`${parsed.data.paymentDate}T12:00:00.000Z`),
    paymentMethod: parsed.data.paymentMethod,
    referenceNumber: parsed.data.referenceNumber,
    notes: parsed.data.notes,
    idempotencyKey: parsed.data.idempotencyKey || undefined,
    enabledModules: tenant.enabledModules,
  });
  revalidateInvoiceRoutes();
  void result;
}

export async function cancelInvoiceAction(formData: FormData) {
  const tenant = await requireInvoicePermission(
    'sales_purchase.invoice.cancel',
    'sales_purchase.manage',
  );
  const invoiceId = z.string().cuid().safeParse(formData.get('invoiceId'));
  if (!invoiceId.success) return;
  const result = await cancelInvoice({
    organizationId: tenant.organizationId,
    invoiceId: invoiceId.data,
    cancelledById: tenant.userId,
    enabledModules: tenant.enabledModules,
  });
  revalidateInvoiceRoutes();
  void result;
}
function revalidateInvoiceRoutes() {
  revalidatePath('/sales-purchase/invoices');
  revalidatePath('/inventory/products');
  revalidatePath('/accounting');
  revalidatePath('/dashboard');
  revalidatePath('/reports');
}
