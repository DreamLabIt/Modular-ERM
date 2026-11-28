import { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { TenantScopeError, ValidationError } from '@/core/errors';
import { recordAuditLog } from '@/core/audit';
import { getOrganizationSettings } from './index';
import { DOCUMENT_TYPES, type DocumentType } from './document-numbering';

export async function updateOrganizationSettings(input: {
  organizationId: string;
  actorUserId: string;
  values: {
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
  };
}) {
  const settings = await getOrganizationSettings(input.organizationId);
  const updated = await prisma.organizationSettings.update({
    where: { id: settings.id },
    data: {
      ...input.values,
    },
  });
  await prisma.organization.update({
    where: { id: input.organizationId },
    data: {
      currency: input.values.currencyCode,
    },
  });
  await recordAuditLog({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: 'SETTINGS_UPDATED',
    resource: 'ORGANIZATION_SETTINGS',
    resourceId: updated.id,
    description: 'Updated regional and finance settings.',
    after: input.values as unknown as Prisma.InputJsonValue,
  });
  return updated;
}

export async function updateCompanyProfile(input: {
  organizationId: string;
  actorUserId: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  taxId: string;
  registrationNumber: string;
}) {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new ValidationError('Company name is required.');
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    throw new ValidationError('Enter a valid company email address.');
  }
  const updated = await prisma.organization.update({
    where: { id: input.organizationId },
    data: {
      name,
      address: input.address.trim().slice(0, 500) || null,
      phone: input.phone.trim().slice(0, 50) || null,
      email: input.email.trim().slice(0, 254) || null,
      website: input.website.trim().slice(0, 200) || null,
      taxId: input.taxId.trim().slice(0, 50) || null,
      registrationNumber: input.registrationNumber.trim().slice(0, 50) || null,
    },
  });
  await recordAuditLog({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: 'COMPANY_PROFILE_UPDATED',
    resource: 'ORGANIZATION',
    resourceId: updated.id,
    description: 'Updated company profile.',
    after: { name, email: input.email },
  });
  return updated;
}

export async function listTaxConfigurations(organizationId: string) {
  return prisma.taxConfiguration.findMany({
    where: { organizationId },
    orderBy: { code: 'asc' },
  });
}

export async function upsertTaxConfiguration(input: {
  organizationId: string;
  actorUserId: string;
  id?: string;
  name: string;
  code: string;
  rate: string;
  taxType: string;
  isInclusive: boolean;
  isActive: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
}) {
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  const rate = Number(input.rate);
  const taxTypes = ['VAT', 'SALES', 'INCOME', 'WITHHOLDING', 'OTHER'];
  if (!name || !code) throw new ValidationError('Tax name and code are required.');
  if (!/^[A-Z0-9_-]{2,20}$/.test(code)) {
    throw new ValidationError('Tax code may contain letters, digits, "-" and "_" only.');
  }
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new ValidationError('Tax rate must be between 0 and 100.');
  }
  if (!taxTypes.includes(input.taxType)) throw new ValidationError('Unsupported tax type.');
  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : null;
  const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
  if (effectiveFrom && Number.isNaN(effectiveFrom.getTime())) throw new ValidationError('Invalid effective date.');
  if (effectiveTo && Number.isNaN(effectiveTo.getTime())) throw new ValidationError('Invalid effective date.');
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
    throw new ValidationError('Effective end date must be after the start date.');
  }

  const existing = input.id
    ? await prisma.taxConfiguration.findFirst({
        where: { id: input.id, organizationId: input.organizationId },
      })
    : null;
  if (input.id && !existing) throw new TenantScopeError();

  const data = {
    organizationId: input.organizationId,
    name,
    code,
    rate: new Prisma.Decimal(rate.toString()),
    taxType: input.taxType,
    isInclusive: Boolean(input.isInclusive),
    isActive: Boolean(input.isActive),
    effectiveFrom,
    effectiveTo,
  };
  const saved = existing
    ? await prisma.taxConfiguration.update({ where: { id: existing.id }, data })
    : await prisma.taxConfiguration.create({ data });

  await recordAuditLog({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: existing ? 'TAX_UPDATED' : 'TAX_CREATED',
    resource: 'TAX_CONFIGURATION',
    resourceId: saved.id,
    description: `${existing ? 'Updated' : 'Created'} tax ${code}.`,
    after: { name, code, rate, taxType: input.taxType },
  });
  return saved;
}

export async function deleteTaxConfiguration(input: {
  organizationId: string;
  actorUserId: string;
  id: string;
}) {
  const tax = await prisma.taxConfiguration.findFirst({
    where: { id: input.id, organizationId: input.organizationId },
  });
  if (!tax) throw new TenantScopeError();
  await prisma.taxConfiguration.delete({ where: { id: tax.id } });
  await recordAuditLog({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: 'TAX_DELETED',
    resource: 'TAX_CONFIGURATION',
    resourceId: tax.id,
    description: `Deleted tax ${tax.code}.`,
  });
}

export async function listFiscalYears(organizationId: string) {
  return prisma.fiscalYear.findMany({
    where: { organizationId },
    orderBy: { startDate: 'desc' },
  });
}

export async function createFiscalYear(input: {
  organizationId: string;
  actorUserId: string;
  name: string;
  startDate: string;
  endDate: string;
  setCurrent?: boolean;
}) {
  const name = input.name.trim();
  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  if (!name || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new ValidationError('Fiscal year name and dates are required.');
  }
  if (endDate <= startDate) throw new ValidationError('End date must be after the start date.');

  return prisma.$transaction(async (tx) => {
    if (input.setCurrent) {
      await tx.fiscalYear.updateMany({
        where: { organizationId: input.organizationId, isCurrent: true },
        data: { isCurrent: false },
      });
    }
    const created = await tx.fiscalYear.create({
      data: {
        organizationId: input.organizationId,
        name,
        startDate,
        endDate,
        isCurrent: Boolean(input.setCurrent),
      },
    });
    await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'FISCAL_YEAR_CREATED',
        resource: 'FISCAL_YEAR',
        resourceId: created.id,
        description: `Created fiscal year ${name}.`,
      },
      tx,
    );
    return created;
  });
}

export async function setCurrentFiscalYear(input: {
  organizationId: string;
  actorUserId: string;
  id: string;
}) {
  const fiscalYear = await prisma.fiscalYear.findFirst({
    where: { id: input.id, organizationId: input.organizationId, status: 'OPEN' },
  });
  if (!fiscalYear) throw new TenantScopeError();
  await prisma.$transaction(async (tx) => {
    await tx.fiscalYear.updateMany({
      where: { organizationId: input.organizationId },
      data: { isCurrent: false },
    });
    await tx.fiscalYear.update({ where: { id: fiscalYear.id }, data: { isCurrent: true } });
    await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'FISCAL_YEAR_ACTIVATED',
        resource: 'FISCAL_YEAR',
        resourceId: fiscalYear.id,
        description: `Set ${fiscalYear.name} as the current fiscal year.`,
      },
      tx,
    );
  });
}

export async function closeFiscalYear(input: {
  organizationId: string;
  actorUserId: string;
  id: string;
}) {
  const fiscalYear = await prisma.fiscalYear.findFirst({
    where: { id: input.id, organizationId: input.organizationId, status: 'OPEN' },
  });
  if (!fiscalYear) throw new TenantScopeError();
  await prisma.$transaction(async (tx) => {
    await tx.fiscalYear.update({
      where: { id: fiscalYear.id },
      data: {
        status: 'CLOSED',
        isCurrent: false,
        closedAt: new Date(),
        closedById: input.actorUserId,
      },
    });
    await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'FISCAL_YEAR_CLOSED',
        resource: 'FISCAL_YEAR',
        resourceId: fiscalYear.id,
        description: `Closed fiscal year ${fiscalYear.name}.`,
      },
      tx,
    );
  });
}

export async function reopenFiscalYear(input: {
  organizationId: string;
  actorUserId: string;
  id: string;
}) {
  const fiscalYear = await prisma.fiscalYear.findFirst({
    where: { id: input.id, organizationId: input.organizationId, status: 'CLOSED' },
  });
  if (!fiscalYear) throw new TenantScopeError();
  await prisma.$transaction(async (tx) => {
    await tx.fiscalYear.update({
      where: { id: fiscalYear.id },
      data: {
        status: 'OPEN',
        reopenedAt: new Date(),
        reopenedById: input.actorUserId,
      },
    });
    await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'FISCAL_YEAR_REOPENED',
        resource: 'FISCAL_YEAR',
        resourceId: fiscalYear.id,
        description: `Reopened fiscal year ${fiscalYear.name}.`,
      },
      tx,
    );
  });
}

export async function listDocumentSequences(organizationId: string) {
  const existing = await prisma.documentSequence.findMany({
    where: { organizationId },
    orderBy: { documentType: 'asc' },
  });
  const byType = new Map(existing.map((sequence) => [sequence.documentType, sequence]));
  return Object.entries(DOCUMENT_TYPES).map(([documentType, config]) => {
    const row = byType.get(documentType);
    return {
      documentType,
      label: config.label,
      id: row?.id ?? null,
      prefix: row?.prefix ?? config.prefix,
      suffix: row?.suffix ?? '',
      startingNumber: row?.startingNumber ?? 1,
      padding: row?.padding ?? 6,
      includeFiscalYear: row?.includeFiscalYear ?? config.includeFiscalYear,
      includeDate: row?.includeDate ?? false,
      nextNumber: row?.nextNumber ?? 1,
      resetPolicy: row?.resetPolicy ?? 'YEARLY',
    };
  });
}

export async function upsertDocumentSequence(input: {
  organizationId: string;
  actorUserId: string;
  documentType: string;
  prefix: string;
  suffix: string;
  startingNumber: number;
  padding: number;
  includeFiscalYear: boolean;
  includeDate: boolean;
  resetPolicy: string;
}) {
  const documentType = input.documentType as DocumentType;
  if (!(documentType in DOCUMENT_TYPES)) throw new ValidationError('Unknown document type.');
  const padding = Number(input.padding);
  const startingNumber = Number(input.startingNumber);
  if (!Number.isInteger(padding) || padding < 1 || padding > 12) {
    throw new ValidationError('Padding must be between 1 and 12.');
  }
  if (!Number.isInteger(startingNumber) || startingNumber < 1 || startingNumber > 1000000) {
    throw new ValidationError('Starting number must be between 1 and 1000000.');
  }
  if (!['YEARLY', 'NEVER'].includes(input.resetPolicy)) {
    throw new ValidationError('Unsupported reset policy.');
  }

  const saved = await prisma.documentSequence.upsert({
    where: {
      organizationId_documentType: {
        organizationId: input.organizationId,
        documentType,
      },
    },
    update: {
      prefix: input.prefix.slice(0, 20),
      suffix: input.suffix.slice(0, 20),
      startingNumber,
      padding,
      includeFiscalYear: Boolean(input.includeFiscalYear),
      includeDate: Boolean(input.includeDate),
      resetPolicy: input.resetPolicy,
    },
    create: {
      organizationId: input.organizationId,
      documentType,
      prefix: input.prefix.slice(0, 20),
      suffix: input.suffix.slice(0, 20),
      startingNumber,
      padding,
      includeFiscalYear: Boolean(input.includeFiscalYear),
      includeDate: Boolean(input.includeDate),
      resetPolicy: input.resetPolicy,
    },
  });
  await recordAuditLog({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: 'DOCUMENT_SEQUENCE_UPDATED',
    resource: 'DOCUMENT_SEQUENCE',
    resourceId: saved.id,
    description: `Updated numbering for ${documentType}.`,
  });
  return saved;
}
