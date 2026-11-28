export interface SmsSendResult {
  provider: string;
  messageId?: string;
}

export interface SmsProvider {
  name: string;
  isConfigured(): boolean;
  send(input: { to: string; body: string }): Promise<SmsSendResult>;
}

export class SmsNotConfiguredError extends Error {
  constructor() {
    super(
      'No SMS provider is configured. Set SMS_PROVIDER=twilio plus TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER.',
    );
    this.name = 'SmsNotConfiguredError';
  }
}

export function isValidPhoneNumber(phone: string): boolean {
  const normalized = phone.trim();
  return /^\+[1-9]\d{6,14}$/.test(normalized);
}

class TwilioSmsProvider implements SmsProvider {
  name = 'twilio';

  isConfigured(): boolean {
    return Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_FROM_NUMBER,
    );
  }

  async send(input: { to: string; body: string }): Promise<SmsSendResult> {
    if (!this.isConfigured()) throw new SmsNotConfiguredError();
    if (!isValidPhoneNumber(input.to)) {
      throw new Error('Phone number must be in E.164 format, for example +8801700000000.');
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID as string;
    const authToken = process.env.TWILIO_AUTH_TOKEN as string;
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: input.to,
          From: process.env.TWILIO_FROM_NUMBER as string,
          Body: input.body.slice(0, 1600),
        }),
        cache: 'no-store',
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Twilio rejected the message (${response.status}): ${detail.slice(0, 300)}`);
    }

    const payload = (await response.json().catch(() => ({}))) as { sid?: string };
    return { provider: this.name, messageId: payload.sid };
  }
}

class UnconfiguredSmsProvider implements SmsProvider {
  name = 'unconfigured';
  isConfigured(): boolean {
    return false;
  }
  async send(): Promise<SmsSendResult> {
    throw new SmsNotConfiguredError();
  }
}

export function getSmsProvider(): SmsProvider {
  const provider = (process.env.SMS_PROVIDER || '').toLowerCase();
  if (provider === 'twilio') return new TwilioSmsProvider();
  return new UnconfiguredSmsProvider();
}

export function isSmsConfigured(): boolean {
  return getSmsProvider().isConfigured();
}
