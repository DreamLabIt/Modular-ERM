import { createHmac, timingSafeEqual } from 'crypto';

export interface PaymentSession {
  provider: string;
  reference: string;
  checkoutUrl?: string;
  status: 'PENDING' | 'REQUIRES_ACTION';
}

export interface PaymentVerification {
  verified: boolean;
  reference: string;
  amount: number;
  currency: string;
  merchantReference?: string;
  status: 'PAID' | 'FAILED' | 'PENDING';
  raw?: Record<string, unknown>;
}

export interface WebhookResult {
  eventId: string;
  reference: string;
  status: PaymentVerification['status'];
  amount?: number;
  currency?: string;
  merchantReference?: string;
}

export interface PaymentProvider {
  name: string;
  displayName: string;
  isConfigured(): boolean;
  createSession(input: {
    amount: number;
    currency: string;
    invoiceNumber: string;
    idempotencyKey: string;
    callbackUrl: string;
  }): Promise<PaymentSession>;
  verify(input: { reference: string; expectedAmount: number; expectedCurrency: string }): Promise<PaymentVerification>;
  parseWebhook?(input: { rawBody: string; signature: string }): Promise<WebhookResult>;
  refund?(input: { reference: string; amount: number }): Promise<{ refunded: boolean; reference: string }>;
}

export class PaymentProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(
      `Payment provider "${provider}" is not configured. Configure its credentials in the environment before accepting payments.`,
    );
    this.name = 'PaymentProviderNotConfiguredError';
  }
}

function requireConfig(values: Array<string | undefined>, provider: string) {
  if (values.some((value) => !value)) throw new PaymentProviderNotConfiguredError(provider);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyHmacSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const normalized = signature.toLowerCase().replace(/^sha256=/, '');
  return safeEqual(expected, normalized);
}

class ManualBankTransferProvider implements PaymentProvider {
  name = 'MANUAL_BANK';
  displayName = 'Manual Bank Transfer';
  isConfigured() {
    return true;
  }
  async createSession(input: Parameters<PaymentProvider['createSession']>[0]): Promise<PaymentSession> {
    return {
      provider: this.name,
      reference: `manual:${input.idempotencyKey}`,
      status: 'PENDING',
    };
  }
  async verify(input: Parameters<PaymentProvider['verify']>[0]): Promise<PaymentVerification> {
    // Manual transfers are only settled after explicit platform/admin approval.
    return {
      verified: false,
      reference: input.reference,
      amount: input.expectedAmount,
      currency: input.expectedCurrency,
      status: 'PENDING',
    };
  }
}

/**
 * SSLCommerz adapter. Uses the documented hosted-checkout and validation
 * endpoints. It is only active when sandbox/live credentials are configured;
 * no credentials are stored in source or seed data.
 */
class SslCommerzProvider implements PaymentProvider {
  name = 'SSLCOMMERZ';
  displayName = 'SSLCommerz';
  private baseUrl() {
    return process.env.SSLCOMMERZ_ENVIRONMENT === 'LIVE'
      ? 'https://securepay.sslcommerz.com'
      : 'https://sandbox.sslcommerz.com';
  }
  isConfigured() {
    return Boolean(process.env.SSLCOMMERZ_STORE_ID && process.env.SSLCOMMERZ_STORE_PASSWORD);
  }
  async createSession(input: Parameters<PaymentProvider['createSession']>[0]): Promise<PaymentSession> {
    requireConfig([process.env.SSLCOMMERZ_STORE_ID, process.env.SSLCOMMERZ_STORE_PASSWORD], this.name);
    const form = new URLSearchParams({
      store_id: process.env.SSLCOMMERZ_STORE_ID as string,
      store_passwd: process.env.SSLCOMMERZ_STORE_PASSWORD as string,
      total_amount: input.amount.toFixed(2),
      currency: input.currency,
      tran_id: input.idempotencyKey.slice(0, 60),
      success_url: input.callbackUrl,
      fail_url: input.callbackUrl,
      cancel_url: input.callbackUrl,
      ipn_url: `${process.env.NEXTAUTH_URL ?? ''}/api/billing/webhooks/sslcommerz`,
      cus_name: 'ERM Customer',
      cus_email: process.env.BILLING_SUPPORT_EMAIL ?? 'billing@example.com',
      cus_phone: '01700000000',
      cus_add1: 'N/A',
      cus_city: 'Dhaka',
      cus_country: 'Bangladesh',
      shipping_method: 'NO',
      product_name: `Invoice ${input.invoiceNumber}`,
      product_category: 'SaaS Subscription',
      product_profile: 'general',
    });
    const response = await fetch(`${this.baseUrl()}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`SSLCommerz session request failed (${response.status}).`);
    const payload = (await response.json()) as {
      status?: string;
      sessionkey?: string;
      GatewayPageURL?: string;
      failedreason?: string;
    };
    if (payload.status !== 'SUCCESS' || !payload.GatewayPageURL) {
      throw new Error(payload.failedreason ?? 'SSLCommerz did not return a checkout URL.');
    }
    return {
      provider: this.name,
      reference: payload.sessionkey ?? input.idempotencyKey,
      checkoutUrl: payload.GatewayPageURL,
      status: 'REQUIRES_ACTION',
    };
  }
  async verify(input: Parameters<PaymentProvider['verify']>[0]): Promise<PaymentVerification> {
    requireConfig([process.env.SSLCOMMERZ_STORE_ID, process.env.SSLCOMMERZ_STORE_PASSWORD], this.name);
    const url = new URL(`${this.baseUrl()}/validator/api/validationserverAPI.php`);
    url.searchParams.set('val_id', input.reference);
    url.searchParams.set('store_id', process.env.SSLCOMMERZ_STORE_ID as string);
    url.searchParams.set('store_passwd', process.env.SSLCOMMERZ_STORE_PASSWORD as string);
    url.searchParams.set('format', 'json');
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`SSLCommerz validation failed (${response.status}).`);
    const payload = (await response.json()) as Record<string, string>;
    const amount = Number(payload.total_amount ?? 0);
    const currency = payload.currency ?? 'BDT';
    const paid = ['VALID', 'VALIDATED'].includes(payload.status ?? '');
    return {
      verified: paid && amount === input.expectedAmount && currency === input.expectedCurrency,
      reference: input.reference,
      amount,
      currency,
      merchantReference: payload.tran_id,
      status: paid ? 'PAID' : 'FAILED',
      raw: payload,
    };
  }
  async parseWebhook(input: Parameters<NonNullable<PaymentProvider['parseWebhook']>>[0]): Promise<WebhookResult> {
    const secret = process.env.SSLCOMMERZ_WEBHOOK_SECRET;
    if (!verifyHmacSignature(input.rawBody, input.signature, secret ?? '')) {
      throw new Error('Invalid SSLCommerz webhook signature.');
    }
    const payload = JSON.parse(input.rawBody) as Record<string, string>;
    const eventId = payload.tran_id ?? payload.val_id ?? '';
    if (!eventId) throw new Error('Webhook is missing a transaction reference.');
    return {
      eventId,
      reference: payload.val_id ?? payload.tran_id ?? '',
      status: ['VALID', 'VALIDATED'].includes(payload.status ?? '') ? 'PAID' : 'FAILED',
      amount: Number(payload.total_amount ?? 0),
      currency: payload.currency,
      merchantReference: payload.tran_id,
    };
  }
}

/**
 * bKash and Nagad require merchant credentials and gateway-specific callback
 * contracts. The adapters are present so billing logic stays decoupled, but
 * they refuse to create sessions until credentials and webhook secrets exist.
 * They are intentionally NOT advertised as integrated.
 */
class ConfigurationOnlyProvider implements PaymentProvider {
  constructor(
    readonly name: string,
    readonly displayName: string,
    private readonly required: string[],
  ) {}
  isConfigured() {
    return this.required.every((key) => Boolean(process.env[key]));
  }
  async createSession(input: Parameters<PaymentProvider['createSession']>[0]): Promise<PaymentSession> {
    requireConfig(this.required.map((key) => process.env[key]), this.name);
    throw new Error(
      `${this.displayName} adapter is not yet enabled for live checkout. Configure and verify the gateway callback contract before use.`,
    );
  }
  async verify(input: Parameters<PaymentProvider['verify']>[0]): Promise<PaymentVerification> {
    requireConfig(this.required.map((key) => process.env[key]), this.name);
    return {
      verified: false,
      reference: input.reference,
      amount: input.expectedAmount,
      currency: input.expectedCurrency,
      status: 'PENDING',
    };
  }
}

const PROVIDERS: PaymentProvider[] = [
  new ManualBankTransferProvider(),
  new SslCommerzProvider(),
  new ConfigurationOnlyProvider('BKASH', 'bKash', ['BKASH_APP_KEY', 'BKASH_APP_SECRET', 'BKASH_ACCOUNT_NUMBER']),
  new ConfigurationOnlyProvider('NAGAD', 'Nagad', ['NAGAD_ACCOUNT_NUMBER', 'NAGAD_MERCHANT_ID']),
];

export function getPaymentProvider(name: string): PaymentProvider {
  const provider = PROVIDERS.find((candidate) => candidate.name === name.toUpperCase());
  if (!provider) throw new Error('Unsupported payment provider.');
  return provider;
}

export function listPaymentProviders() {
  return PROVIDERS.map((provider) => ({
    name: provider.name,
    displayName: provider.displayName,
    configured: provider.isConfigured(),
    supported: provider.name !== 'BKASH' && provider.name !== 'NAGAD',
  }));
}
