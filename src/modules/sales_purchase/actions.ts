'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireModuleAccess } from '@/core/auth/module-guard';
import { hasPermission } from '@/lib/permissions';
import type { Permission } from '@/core/types';
import {
  cancelInvoice,
  createInvoice,
  createPurchaseOrder,
  createSupplier,
  deleteDraftInvoice,
  issueInvoice,
  recordInvoicePayment,
  updateDraftInvoice,
} from './model';

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

const createSchema = z.object({
  customerId: z.string().cuid(),
  productId: z.string().cuid(),
  quantity: z.coerce.number().int().positive(),
  taxPercent: z.coerce.number().min(0).max(100),
  dueDate: z.string().optional(),
});

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

export async function createSupplierAction(formData: FormData) {
  const tenant = await requireModuleAccess('sales_purchase', 'sales_purchase.manage');
  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  if (!name) return;
  await createSupplier({ organizationId: tenant.organizationId, name, email, phone });
  revalidatePath('/sales-purchase/purchases');
}

export async function createPurchaseOrderAction(formData: FormData) {
  const tenant = await requireModuleAccess('sales_purchase', 'sales_purchase.manage');
  const supplierId = String(formData.get('supplierId') || '');
  const productId = String(formData.get('productId') || '');
  const quantity = Math.max(1, Number(formData.get('quantity') || 1));
  if (!supplierId || !productId) return;
  await createPurchaseOrder({
    organizationId: tenant.organizationId,
    supplierId,
    productId,
    quantity,
    enabledModules: tenant.enabledModules,
  });
  revalidatePath('/sales-purchase/purchases');
  revalidatePath('/inventory/products');
  revalidatePath('/accounting');
  revalidatePath('/dashboard');
}

function revalidateInvoiceRoutes() {
  revalidatePath('/sales-purchase/invoices');
  revalidatePath('/inventory/products');
  revalidatePath('/accounting');
  revalidatePath('/dashboard');
  revalidatePath('/reports');
}
