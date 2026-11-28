import { randomUUID } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { ValidationError, AuthorizationError } from '@/core/errors';
import { billingAudit } from '../audit';
import { settleInvoice, getInvoiceForOrganization } from '../invoices';
import { recoverAfterPayment, activatePaidSubscription, markPaymentFailed } from '../subscriptions';
import { getPaymentProvider, verifyHmacSignature } from './providers';

type Db = Prisma.TransactionClient | PrismaClient;

export interface InitiatePaymentInput {
  organizationId: string;
  invoiceId: string;
  provider: string;
  actorUserId: string;
  actorEmail: string;
  idempotencyKey?: string;
  callbackUrl?: string;
}

export async function initiatePayment(input: InitiatePaymentInput) {
  const provider = getPaymentProvider(input.provider);
  if (!provider.isConfigured()) {
    throw new ValidationError(
      `${provider.displayName} is not configured. Configure its credentials before accepting payments.`,
    );
  }

  const invoice = await getInvoiceForOrganization(input.organizationId, input.invoiceId);
  if (!['PENDING', 'PARTIALLY_PAID', 'OVERDUE', 'DRAFT'].includes(invoice.status)) {
    throw new ValidationError('This invoice cannot be paid.');
  }
  if (invoice.status === 'DRAFT') {
    throw new ValidationError('Finalize the invoice before accepting payment.');
  }
  const outstanding = new Prisma.Decimal(invoice.totalAmount).minus(invoice.amountPaid);
  if (outstanding.lessThanOrEqualTo(0)) throw new ValidationError('This invoice is already paid.');

  const idempotencyKey = (input.idempotencyKey ?? '').trim().slice(0, 100) || randomUUID();
  const existing = await prisma.payment.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.organizationId !== input.organizationId || existing.invoiceId !== invoice.id) {
      throw new AuthorizationError('Idempotency key belongs to another payment.');
    }
    return existing;
  }

  const session = await provider.createSession({
    amount: Number(outstanding),
    currency: invoice.currency,
    invoiceNumber: invoice.invoiceNumber,
    idempotencyKey,
    callbackUrl:
      input.callbackUrl ?? `${process.env.NEXTAUTH_URL ?? ''}/platform-admin/payments/callback`,
  });

  const payment = await prisma.payment.create({
    data: {
      organizationId: input.organizationId,
      invoiceId: invoice.id,
      subscriptionId: invoice.subscriptionId,
      provider: provider.name,
      method: provider.name === 'MANUAL_BANK' ? 'BANK_TRANSFER' : 'GATEWAY',
      status: 'PENDING',
      amount: outstanding,
      currency: invoice.currency,
      providerReference: session.reference,
      idempotencyKey,
      metadata: { checkoutUrl: session.checkoutUrl ?? null } as Prisma.InputJsonValue,
    },
  });
  await prisma.paymentAttempt.create({
    data: {
      paymentId: payment.id,
      organizationId: input.organizationId,
      provider: provider.name,
      status: 'INITIATED',
      reference: session.reference,
      idempotencyKey,
    },
  });
  await billingAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: 'PAYMENT_INITIATED',
    resource: 'PAYMENT',
    resourceId: payment.id,
    metadata: { provider: provider.name, amount: outstanding.toString() },
  });
  return { ...payment, checkoutUrl: session.checkoutUrl };
}

/**
 * Authoritative settlement. Accepts either a verified gateway response or an
 * explicit manual approval from a platform administrator. Never trusts a
 * browser redirect or a client-provided success flag.
 */
export async function verifyAndSettlePayment(input: {
  organizationId: string;
  paymentId: string;
  reference?: string;
  manualApproval?: { adminId: string; adminEmail: string };
  verifiedBy?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: input.paymentId, organizationId: input.organizationId },
      include: { invoice: true },
    });
    if (!payment) throw new ValidationError('Payment not found.');
    if (payment.status === 'PAID') return payment;
    if (payment.status === 'FAILED' && !input.manualApproval) {
      throw new ValidationError('A failed payment cannot be retried in place. Create a new payment.');
    }

    const provider = getPaymentProvider(payment.provider);
    let verified = false;
    let reference = input.reference ?? payment.providerReference ?? '';

    if (input.manualApproval) {
      if (payment.provider !== 'MANUAL_BANK') {
        throw new AuthorizationError('Manual approval is only valid for bank transfer payments.');
      }
      verified = true;
      reference = `manual-approved:${input.manualApproval.adminId}`;
    } else {
      const result = await provider.verify({
        reference,
        expectedAmount: Number(payment.amount),
        expectedCurrency: payment.currency,
      });
      verified = result.verified && result.amount === Number(payment.amount) && result.currency === payment.currency;
      reference = result.reference || reference;
    }

    await tx.paymentAttempt.create({
      data: {
        paymentId: payment.id,
        organizationId: input.organizationId,
        provider: payment.provider,
        status: verified ? 'VERIFIED' : 'FAILED',
        reference,
        idempotencyKey: payment.idempotencyKey,
      },
    });

    if (!verified) {
      const failed = await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failureReason: 'Provider verification did not confirm payment.' },
      });
      await markPaymentFailed({
        organizationId: input.organizationId,
        failureReason: 'Payment verification failed',
        db: tx,
      });
      await billingAudit({
        organizationId: input.organizationId,
        action: 'PAYMENT_FAILED',
        resource: 'PAYMENT',
        resourceId: payment.id,
        metadata: { provider: payment.provider },
        db: tx,
      });
      return failed;
    }

    const invoice = await settleInvoice({
      organizationId: input.organizationId,
      invoiceId: payment.invoiceId,
      amount: payment.amount.toString(),
      db: tx,
    });
    const settled = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'PAID',
        providerReference: reference,
        paidAt: new Date(),
        verifiedAt: new Date(),
        failureReason: null,
      },
    });
    await billingAudit({
      organizationId: input.organizationId,
      action: 'PAYMENT_VERIFIED',
      resource: 'PAYMENT',
      resourceId: payment.id,
      metadata: { provider: payment.provider, invoiceNumber: invoice.invoiceNumber },
      db: tx,
    });
    if (invoice.status === 'PAID') {
      await billingAudit({
        organizationId: input.organizationId,
        action: 'INVOICE_SETTLED',
        resource: 'BILLING_INVOICE',
        resourceId: invoice.id,
        db: tx,
      });
    }

    // Restore entitlements only after authoritative settlement.
    if (payment.subscriptionId) {
      await recoverAfterPayment({
        organizationId: input.organizationId,
        actorEmail: input.verifiedBy ?? input.manualApproval?.adminEmail,
        db: tx,
      }).catch(() => undefined);
    }
    return { payment: settled, invoice };
  });
}

/** Idempotent webhook intake with signature verification and deduplication. */
export async function processPaymentWebhook(input: {
  provider: string;
  rawBody: string;
  signature: string;
  eventId?: string;
}) {
  const provider = getPaymentProvider(input.provider);
  if (!provider.parseWebhook) throw new ValidationError('This provider does not support webhooks.');
  const parsed = await provider.parseWebhook({ rawBody: input.rawBody, signature: input.signature });

  const event = await prisma.paymentWebhookEvent.create({
    data: {
      provider: provider.name,
      eventId: parsed.eventId || input.eventId || randomUUID(),
      signatureValid: true,
      payload: JSON.parse(input.rawBody) as Prisma.InputJsonValue,
      status: 'PENDING',
    },
  }).catch(async (error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return null;
    }
    throw error;
  });
  if (!event) return { duplicate: true, processed: false };

  try {
    const payment = await prisma.payment.findFirst({
      where: {
        provider: provider.name,
        OR: [
          { providerReference: parsed.merchantReference ?? parsed.reference },
          { idempotencyKey: parsed.merchantReference ?? parsed.reference },
        ],
      },
    });
    if (!payment) throw new ValidationError('No matching payment for this webhook.');
    if (parsed.amount !== undefined && Number(payment.amount) !== parsed.amount) {
      throw new ValidationError('Webhook amount does not match the payment.');
    }
    if (parsed.currency && payment.currency !== parsed.currency) {
      throw new ValidationError('Webhook currency does not match the payment.');
    }
    if (parsed.status === 'PAID') {
      await verifyAndSettlePayment({
        organizationId: payment.organizationId,
        paymentId: payment.id,
        reference: parsed.reference,
      });
    } else if (parsed.status === 'FAILED') {
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'FAILED', failureReason: 'Gateway reported a failed payment.' },
        });
        await markPaymentFailed({
          organizationId: payment.organizationId,
          failureReason: 'Gateway webhook reported failure',
          db: tx,
        });
      });
    }
    await prisma.paymentWebhookEvent.update({
      where: { id: event.id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });
    return { duplicate: false, processed: true };
  } catch (error) {
    await prisma.paymentWebhookEvent.update({
      where: { id: event.id },
      data: {
        status: 'FAILED',
        error: error instanceof Error ? error.message.slice(0, 500) : 'Webhook processing failed',
      },
    });
    throw error;
  }
}

export async function approveManualPayment(input: {
  organizationId: string;
  paymentId: string;
  admin: { id: string; email: string };
}) {
  return verifyAndSettlePayment({
    organizationId: input.organizationId,
    paymentId: input.paymentId,
    manualApproval: { adminId: input.admin.id, adminEmail: input.admin.email },
  });
}

export async function listPaymentsForOrganization(organizationId: string, take = 100) {
  return prisma.payment.findMany({
    where: { organizationId },
    include: { invoice: { select: { invoiceNumber: true } } },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

export async function listAllPayments(take = 100) {
  return prisma.payment.findMany({
    include: { organization: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

export { verifyHmacSignature };
