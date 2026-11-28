export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title: string, body: string, organizationName?: string): string {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr><td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
          <tr><td style="padding:24px 28px;border-bottom:1px solid #e2e8f0;">
            <strong style="font-size:16px;color:#1d4ed8;">${escapeHtml(organizationName ?? 'Modular ERM')}</strong>
          </td></tr>
          <tr><td style="padding:28px;">
            <h1 style="margin:0 0 16px;font-size:20px;">${escapeHtml(title)}</h1>
            ${body}
          </td></tr>
          <tr><td style="padding:18px 28px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
            This is an automated message from your organization's ERM platform. Do not reply to this email.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 14px;line-height:1.6;font-size:14px;">${escapeHtml(text)}</p>`;
}

function actionButton(label: string, url?: string): string {
  if (!url) return '';
  return `<p style="margin:22px 0;"><a href="${escapeHtml(url)}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block;">${escapeHtml(label)}</a></p>`;
}

function base(title: string, lines: string[], action?: { label: string; url?: string }, organizationName?: string): RenderedEmail {
  const text = [title, '', ...lines, action?.url ? `\n${action.label}: ${action.url}` : ''].join('\n');
  return {
    subject: title,
    text,
    html: layout(
      title,
      `${lines.map(paragraph).join('')}${action ? actionButton(action.label, action.url) : ''}`,
      organizationName,
    ),
  };
}

export const emailTemplates = {
  welcome: (name: string, organizationName: string, url?: string) =>
    base('Welcome to your ERM workspace', [
      `Hello ${name},`,
      `Your account for ${organizationName} is ready.`,
      'Sign in to access your modules, approvals, and notifications.',
    ], { label: 'Sign in', url }, organizationName),

  invitation: (name: string, organizationName: string, url: string) =>
    base('You have been invited', [
      `Hello ${name || 'there'},`,
      `You have been invited to join ${organizationName}.`,
      'This invitation link expires soon. If you were not expecting it, ignore this email.',
    ], { label: 'Accept invitation', url }, organizationName),

  passwordReset: (url: string, organizationName: string) =>
    base('Reset your password', [
      'We received a request to reset your password.',
      'If you did not request this, no action is required. The link expires shortly.',
    ], { label: 'Reset password', url }, organizationName),

  emailVerification: (url: string, organizationName: string) =>
    base('Verify your email address', [
      'Confirm your email address to finish setting up your account.',
    ], { label: 'Verify email', url }, organizationName),

  leaveRequest: (employeeName: string, leaveType: string, startDate: string, endDate: string, organizationName: string, url?: string) =>
    base('Leave request submitted', [
      `${employeeName} submitted a ${leaveType} leave request.`,
      `Period: ${startDate} to ${endDate}.`,
    ], { label: 'Review request', url }, organizationName),

  approvalRequest: (title: string, requesterName: string, organizationName: string, url?: string) =>
    base('Approval required', [
      `${requesterName} submitted "${title}" for your approval.`,
      'Review the request and approve or reject it with a comment.',
    ], { label: 'Open approval', url }, organizationName),

  approvalResult: (title: string, outcome: string, comment: string | null, organizationName: string, url?: string) =>
    base(`Approval ${outcome.toLowerCase()}`, [
      `Your request "${title}" was ${outcome.toLowerCase()}.`,
      comment ? `Comment: ${comment}` : 'No comment was provided.',
    ], { label: 'View request', url }, organizationName),

  payroll: (period: string, organizationName: string, url?: string) =>
    base('Payroll update', [
      `Your payroll for ${period} has been processed.`,
      'Open your payslips to review the details.',
    ], { label: 'View payslips', url }, organizationName),

  invoice: (invoiceNumber: string, amount: string, dueDate: string, organizationName: string, url?: string) =>
    base('Invoice issued', [
      `Invoice ${invoiceNumber} for ${amount} has been issued.`,
      `Due date: ${dueDate}.`,
    ], { label: 'View invoice', url }, organizationName),

  paymentReminder: (invoiceNumber: string, amount: string, dueDate: string, organizationName: string, url?: string) =>
    base('Payment reminder', [
      `Invoice ${invoiceNumber} for ${amount} is outstanding.`,
      `Due date: ${dueDate}.`,
    ], { label: 'View invoice', url }, organizationName),

  securityAlert: (message: string, organizationName: string, url?: string) =>
    base('Security alert', [
      message,
      'If this was not you, contact your administrator immediately.',
    ], { label: 'Review security settings', url }, organizationName),
};
