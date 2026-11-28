import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { ValidationError } from '@/core/errors';

export interface OrganizationSettingsValues {
  currencyCode: string;
  currencySymbol: string;
  decimalPrecision: number;
  currencyDisplayFormat: string;
  timezone: string;
  dateFormat: string;
  timeFormat: string;
  fiscalYearStartMonth: number;
  fiscalYearStartDay: number;
  weekStartsOn: number;
  enforceSecurityNotifications: boolean;
}

export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettingsValues = {
  currencyCode: 'BDT',
  currencySymbol: '৳',
  decimalPrecision: 2,
  currencyDisplayFormat: 'SYMBOL_BEFORE',
  timezone: 'Asia/Dhaka',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '24H',
  fiscalYearStartMonth: 7,
  fiscalYearStartDay: 1,
  weekStartsOn: 0,
  enforceSecurityNotifications: true,
};

export const CURRENCY_DISPLAY_FORMATS = ['SYMBOL_BEFORE', 'SYMBOL_AFTER', 'CODE_BEFORE'] as const;
export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
export const TIME_FORMATS = ['12H', '24H'] as const;

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function isValidCurrencyCode(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function assertValidOrganizationSettings(
  values: Partial<OrganizationSettingsValues>,
): void {
  if (values.currencyCode && !isValidCurrencyCode(values.currencyCode)) {
    throw new ValidationError('Enter a valid ISO 4217 currency code (for example BDT or USD).');
  }
  if (values.timezone && !isValidTimezone(values.timezone)) {
    throw new ValidationError('Enter a valid IANA timezone (for example Asia/Dhaka).');
  }
  if (values.dateFormat && !DATE_FORMATS.includes(values.dateFormat as never)) {
    throw new ValidationError('Choose a supported date format.');
  }
  if (values.timeFormat && !TIME_FORMATS.includes(values.timeFormat as never)) {
    throw new ValidationError('Choose a supported time format.');
  }
  if (
    values.currencyDisplayFormat &&
    !CURRENCY_DISPLAY_FORMATS.includes(values.currencyDisplayFormat as never)
  ) {
    throw new ValidationError('Choose a supported currency display format.');
  }
  if (
    values.decimalPrecision !== undefined &&
    (!Number.isInteger(values.decimalPrecision) || values.decimalPrecision < 0 || values.decimalPrecision > 6)
  ) {
    throw new ValidationError('Decimal precision must be between 0 and 6.');
  }
  if (
    values.fiscalYearStartMonth !== undefined &&
    (!Number.isInteger(values.fiscalYearStartMonth) ||
      values.fiscalYearStartMonth < 1 ||
      values.fiscalYearStartMonth > 12)
  ) {
    throw new ValidationError('Fiscal year start month must be between 1 and 12.');
  }
  if (
    values.fiscalYearStartDay !== undefined &&
    (!Number.isInteger(values.fiscalYearStartDay) ||
      values.fiscalYearStartDay < 1 ||
      values.fiscalYearStartDay > 28)
  ) {
    throw new ValidationError('Fiscal year start day must be between 1 and 28.');
  }
}

export async function getOrganizationSettings(
  organizationId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<OrganizationSettingsValues & { id: string; organizationId: string }> {
  const existing = await db.organizationSettings.findUnique({ where: { organizationId } });
  if (existing) {
    return {
      id: existing.id,
      organizationId: existing.organizationId,
      currencyCode: existing.currencyCode,
      currencySymbol: existing.currencySymbol,
      decimalPrecision: existing.decimalPrecision,
      currencyDisplayFormat: existing.currencyDisplayFormat,
      timezone: existing.timezone,
      dateFormat: existing.dateFormat,
      timeFormat: existing.timeFormat,
      fiscalYearStartMonth: existing.fiscalYearStartMonth,
      fiscalYearStartDay: existing.fiscalYearStartDay,
      weekStartsOn: existing.weekStartsOn,
      enforceSecurityNotifications: existing.enforceSecurityNotifications,
    };
  }

  // Concurrent requests can reach this path at the same time. INSERT ... ON
  // CONFLICT DO NOTHING prevents a unique violation from aborting a caller's
  // transaction; the losing request simply reads the winner's row.
  await db.$executeRaw`
    INSERT INTO "OrganizationSettings"
      ("id", "organizationId", "currencyCode", "currencySymbol", "decimalPrecision",
       "currencyDisplayFormat", "timezone", "dateFormat", "timeFormat",
       "fiscalYearStartMonth", "fiscalYearStartDay", "weekStartsOn",
       "enforceSecurityNotifications", "createdAt", "updatedAt")
    VALUES
      (${randomUUID()}, ${organizationId}, ${DEFAULT_ORGANIZATION_SETTINGS.currencyCode},
       ${DEFAULT_ORGANIZATION_SETTINGS.currencySymbol}, ${DEFAULT_ORGANIZATION_SETTINGS.decimalPrecision},
       ${DEFAULT_ORGANIZATION_SETTINGS.currencyDisplayFormat}, ${DEFAULT_ORGANIZATION_SETTINGS.timezone},
       ${DEFAULT_ORGANIZATION_SETTINGS.dateFormat}, ${DEFAULT_ORGANIZATION_SETTINGS.timeFormat},
       ${DEFAULT_ORGANIZATION_SETTINGS.fiscalYearStartMonth}, ${DEFAULT_ORGANIZATION_SETTINGS.fiscalYearStartDay},
       ${DEFAULT_ORGANIZATION_SETTINGS.weekStartsOn}, ${DEFAULT_ORGANIZATION_SETTINGS.enforceSecurityNotifications},
       NOW(), NOW())
    ON CONFLICT ("organizationId") DO NOTHING
  `;
  const created = await db.organizationSettings.findUniqueOrThrow({
    where: { organizationId },
  });
  return {
    id: created.id,
    organizationId: created.organizationId,
    currencyCode: created.currencyCode,
    currencySymbol: created.currencySymbol,
    decimalPrecision: created.decimalPrecision,
    currencyDisplayFormat: created.currencyDisplayFormat,
    timezone: created.timezone,
    dateFormat: created.dateFormat,
    timeFormat: created.timeFormat,
    fiscalYearStartMonth: created.fiscalYearStartMonth,
    fiscalYearStartDay: created.fiscalYearStartDay,
    weekStartsOn: created.weekStartsOn,
    enforceSecurityNotifications: created.enforceSecurityNotifications,
  };
}

export function formatCurrencyAmount(
  value: number | string | Prisma.Decimal,
  settings: Pick<
    OrganizationSettingsValues,
    'currencyCode' | 'currencySymbol' | 'decimalPrecision' | 'currencyDisplayFormat'
  >,
): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  const formatted = numeric.toLocaleString('en-US', {
    minimumFractionDigits: settings.decimalPrecision,
    maximumFractionDigits: settings.decimalPrecision,
  });
  switch (settings.currencyDisplayFormat) {
    case 'SYMBOL_AFTER':
      return `${formatted} ${settings.currencySymbol}`;
    case 'CODE_BEFORE':
      return `${settings.currencyCode} ${formatted}`;
    case 'SYMBOL_BEFORE':
    default:
      return `${settings.currencySymbol} ${formatted}`;
  }
}

const dateParts: Record<string, Intl.DateTimeFormatOptions> = {
  'DD/MM/YYYY': { day: '2-digit', month: '2-digit', year: 'numeric' },
  'MM/DD/YYYY': { month: '2-digit', day: '2-digit', year: 'numeric' },
  'YYYY-MM-DD': { year: 'numeric', month: '2-digit', day: '2-digit' },
};

export function formatDateValue(
  value: Date | string | null | undefined,
  settings: Pick<OrganizationSettingsValues, 'dateFormat' | 'timezone'>,
): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    ...(dateParts[settings.dateFormat] ?? dateParts['DD/MM/YYYY']),
    timeZone: settings.timezone,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  if (settings.dateFormat === 'YYYY-MM-DD') {
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  if (settings.dateFormat === 'MM/DD/YYYY') {
    return `${get('month')}/${get('day')}/${get('year')}`;
  }
  return `${get('day')}/${get('month')}/${get('year')}`;
}

export function formatDateTimeValue(
  value: Date | string | null | undefined,
  settings: Pick<OrganizationSettingsValues, 'dateFormat' | 'timeFormat' | 'timezone'>,
): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: settings.timeFormat === '12H',
    timeZone: settings.timezone,
  }).format(date);
  return `${formatDateValue(date, settings)} ${time}`;
}

export function fiscalYearLabelForDate(
  date: Date,
  settings: Pick<OrganizationSettingsValues, 'fiscalYearStartMonth' | 'fiscalYearStartDay' | 'timezone'>,
): { label: string; start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: settings.timezone,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = get('year');
  const month = get('month');
  const day = get('day');

  const beforeFiscalStart =
    month < settings.fiscalYearStartMonth ||
    (month === settings.fiscalYearStartMonth && day < settings.fiscalYearStartDay);

  const startYear = beforeFiscalStart ? year - 1 : year;
  const start = new Date(
    Date.UTC(startYear, settings.fiscalYearStartMonth - 1, settings.fiscalYearStartDay),
  );
  const end = new Date(
    Date.UTC(startYear + 1, settings.fiscalYearStartMonth - 1, settings.fiscalYearStartDay - 1, 23, 59, 59),
  );
  return { label: String(startYear), start, end };
}
