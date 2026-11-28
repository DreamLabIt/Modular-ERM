import type { RenderedEmail } from '../templates';

export interface EmailSendResult {
  provider: string;
  messageId?: string;
}

export interface EmailProvider {
  name: string;
  isConfigured(): boolean;
  send(input: { to: string; email: RenderedEmail }): Promise<EmailSendResult>;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super(
      'No email provider is configured. Set EMAIL_PROVIDER=resend and RESEND_API_KEY, or configure another supported provider.',
    );
    this.name = 'EmailNotConfiguredError';
  }
}

class ResendEmailProvider implements EmailProvider {
  name = 'resend';

  isConfigured(): boolean {
    return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
  }

  async send(input: { to: string; email: RenderedEmail }): Promise<EmailSendResult> {
    if (!this.isConfigured()) throw new EmailNotConfiguredError();
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [input.to],
        subject: input.email.subject,
        html: input.email.html,
        text: input.email.text,
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Resend rejected the email (${response.status}): ${detail.slice(0, 300)}`);
    }

    const payload = (await response.json().catch(() => ({}))) as { id?: string };
    return { provider: this.name, messageId: payload.id };
  }
}

class UnconfiguredEmailProvider implements EmailProvider {
  name = 'unconfigured';
  isConfigured(): boolean {
    return false;
  }
  async send(): Promise<EmailSendResult> {
    throw new EmailNotConfiguredError();
  }
}

export function getEmailProvider(): EmailProvider {
  const provider = (process.env.EMAIL_PROVIDER || '').toLowerCase();
  if (provider === 'resend') return new ResendEmailProvider();
  return new UnconfiguredEmailProvider();
}

export function isEmailConfigured(): boolean {
  return getEmailProvider().isConfigured();
}
