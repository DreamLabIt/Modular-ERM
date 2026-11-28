import { randomBytes } from 'crypto';
import { mkdir, writeFile, readFile, unlink, stat } from 'fs/promises';
import path from 'path';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { ValidationError, TenantScopeError } from '@/core/errors';
import { buildCsv, type ExportCell } from '@/shared/utils/export';
import { buildXlsx } from './xlsx-writer';
import { buildPdfDocument } from '@/shared/utils/pdf';

export type ExportFormat = 'CSV' | 'XLSX' | 'PDF';

interface ExportRow {
  headers: string[];
  rows: ExportCell[][];
}

export interface ExportDefinition {
  resourceType: string;
  label: string;
  moduleKey: string;
  headers: string[];
  query: (
    organizationId: string,
    where: Record<string, unknown>,
  ) => Promise<Array<Record<string, unknown>>>;
  mapRow: (row: Record<string, unknown>) => ExportCell[];
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function amount(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function date(value: unknown): string {
  if (!value) return '';
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function filtered(where: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  if (typeof where.from === 'string' && where.from) {
    result.createdAt = { ...((result.createdAt as object) ?? {}), gte: new Date(where.from) };
  }
  if (typeof where.to === 'string' && where.to) {
    result.createdAt = { ...((result.createdAt as object) ?? {}), lte: new Date(where.to) };
  }
  if (typeof where.status === 'string' && where.status) result.status = where.status;
  if (typeof where.search === 'string' && where.search) {
    result.OR = [
      { name: { contains: where.search, mode: 'insensitive' } },
      { email: { contains: where.search, mode: 'insensitive' } },
      { title: { contains: where.search, mode: 'insensitive' } },
    ];
  }
  return result;
}

function all<T>(records: T[]): Promise<T[]> {
  return Promise.resolve(records);
}

export const EXPORT_DEFINITIONS: Record<string, ExportDefinition> = {
  customers: {
    resourceType: 'customers',
    label: 'Customers',
    moduleKey: 'crm',
    headers: ['ID', 'Name', 'Company', 'Email', 'Phone', 'Status', 'Created'],
    async query(organizationId, where) {
      return all(
        await prisma.customer.findMany({
          where: { organizationId, archivedAt: null, ...filtered(where) },
          orderBy: { createdAt: 'desc' },
          take: 10000,
        }),
      );
    },
    mapRow: (row) => [text(row.id), text(row.name), text(row.company), text(row.email), text(row.phone), text(row.status), date(row.createdAt)],
  },
  leads: {
    resourceType: 'leads',
    label: 'Leads',
    moduleKey: 'crm',
    headers: ['ID', 'Title', 'Contact', 'Email', 'Stage', 'Estimated Value', 'Created'],
    async query(organizationId, where) {
      return all(
        await prisma.lead.findMany({
          where: { organizationId, archivedAt: null, ...filtered(where) },
          orderBy: { createdAt: 'desc' },
          take: 10000,
        }),
      );
    },
    mapRow: (row) => [text(row.id), text(row.title), text(row.contactName), text(row.email), text(row.stage), amount(row.estimatedValue), date(row.createdAt)],
  },
  employees: {
    resourceType: 'employees',
    label: 'Employees',
    moduleKey: 'hrm',
    headers: ['ID', 'Employee Code', 'Name', 'Designation', 'Department', 'Email', 'Basic Salary', 'Status', 'Joining Date'],
    async query(organizationId, where) {
      return all(
        await prisma.employee.findMany({
          where: { organizationId, archivedAt: null, ...filtered(where) },
          orderBy: { createdAt: 'desc' },
          take: 10000,
        }),
      );
    },
    mapRow: (row) => [text(row.id), text(row.employeeCode), text(row.fullName), text(row.designation), text(row.department), text(row.email), amount(row.basicSalary), text(row.status), date(row.joiningDate)],
  },
  products: {
    resourceType: 'products',
    label: 'Products',
    moduleKey: 'inventory',
    headers: ['ID', 'SKU', 'Name', 'Unit', 'Cost Price', 'Selling Price', 'Reorder Level', 'Status'],
    async query(organizationId, where) {
      return all(
        await prisma.product.findMany({
          where: { organizationId, archivedAt: null, ...filtered(where) },
          orderBy: { createdAt: 'desc' },
          take: 10000,
        }),
      );
    },
    mapRow: (row) => [text(row.id), text(row.sku), text(row.name), text(row.unit), amount(row.costPrice), amount(row.sellingPrice), Number(row.reorderLevel ?? 0), text(row.status)],
  },
  invoices: {
    resourceType: 'invoices',
    label: 'Sales Invoices',
    moduleKey: 'sales_purchase',
    headers: ['ID', 'Invoice Number', 'Customer ID', 'Status', 'Subtotal', 'Tax', 'Total', 'Issue Date', 'Due Date'],
    async query(organizationId, where) {
      return all(
        await prisma.invoice.findMany({
          where: { organizationId, ...filtered(where) },
          orderBy: { createdAt: 'desc' },
          take: 10000,
        }),
      );
    },
    mapRow: (row) => [text(row.id), text(row.invoiceNumber), text(row.customerId), text(row.status), amount(row.subtotal), amount(row.taxAmount), amount(row.totalAmount), date(row.issueDate), date(row.dueDate)],
  },
  purchase_orders: {
    resourceType: 'purchase_orders',
    label: 'Purchase Orders',
    moduleKey: 'sales_purchase',
    headers: ['ID', 'PO Number', 'Supplier ID', 'Status', 'Total', 'Expected Date', 'Created'],
    async query(organizationId, where) {
      return all(
        await prisma.purchaseOrder.findMany({
          where: { organizationId, ...filtered(where) },
          orderBy: { createdAt: 'desc' },
          take: 10000,
        }),
      );
    },
    mapRow: (row) => [text(row.id), text(row.poNumber), text(row.supplierId), text(row.status), amount(row.totalAmount), date(row.expectedDate), date(row.createdAt)],
  },
  projects: {
    resourceType: 'projects',
    label: 'Projects',
    moduleKey: 'projects',
    headers: ['ID', 'Name', 'Status', 'Budget', 'Start Date', 'Deadline'],
    async query(organizationId, where) {
      return all(
        await prisma.project.findMany({
          where: { organizationId, ...filtered(where) },
          orderBy: { createdAt: 'desc' },
          take: 10000,
        }),
      );
    },
    mapRow: (row) => [text(row.id), text(row.name), text(row.status), amount(row.budget), date(row.startDate), date(row.deadline)],
  },
  audit_logs: {
    resourceType: 'audit_logs',
    label: 'Audit Logs',
    moduleKey: 'users_roles',
    headers: ['ID', 'Timestamp', 'Actor', 'Action', 'Resource', 'Resource ID', 'Description', 'IP Address'],
    async query(organizationId, where) {
      return all(
        await prisma.auditLog.findMany({
          where: {
            organizationId,
            ...(typeof where.from === 'string' && where.from ? { createdAt: { gte: new Date(where.from) } } : {}),
            ...(typeof where.to === 'string' && where.to ? { createdAt: { lte: new Date(where.to) } } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: 10000,
          include: { user: { select: { email: true } } },
        }),
      );
    },
    mapRow: (row) => [text(row.id), date(row.createdAt), text((row.user as { email?: string } | null)?.email), text(row.action), text(row.resource), text(row.resourceId), text(row.description), text(row.ipAddress)],
  },
  approval_requests: {
    resourceType: 'approval_requests',
    label: 'Approval Requests',
    moduleKey: 'workflows',
    headers: ['ID', 'Title', 'Module', 'Resource', 'Status', 'Current Step', 'Submitted'],
    async query(organizationId, where) {
      return all(
        await prisma.approvalRequest.findMany({
          where: { organizationId, ...(typeof where.status === 'string' && where.status ? { status: where.status } : {}) },
          orderBy: { createdAt: 'desc' },
          take: 10000,
        }),
      );
    },
    mapRow: (row) => [text(row.id), text(row.title), text(row.moduleKey), text(row.resourceType), text(row.status), Number(row.currentStep ?? 0), date(row.submittedAt)],
  },
};

export function getExportDefinition(resourceType: string): ExportDefinition | null {
  return EXPORT_DEFINITIONS[resourceType] ?? null;
}

export const EXPORT_DIRECTORY = path.join(process.cwd(), 'storage', 'exports');

function assertFormat(value: string): ExportFormat {
  if (!['CSV', 'XLSX', 'PDF'].includes(value)) {
    throw new ValidationError('Choose CSV, XLSX, or PDF as the export format.');
  }
  return value as ExportFormat;
}

export function renderExport(
  definition: ExportDefinition,
  format: ExportFormat,
  data: ExportRow,
): { filename: string; mimeType: string; buffer: Buffer } {
  const base = `${definition.resourceType}-${new Date().toISOString().slice(0, 10)}`;
  if (format === 'CSV') {
    return {
      filename: `${base}.csv`,
      mimeType: 'text/csv; charset=utf-8',
      buffer: Buffer.from(`\uFEFF${buildCsv(data.headers, data.rows)}`, 'utf8'),
    };
  }
  if (format === 'XLSX') {
    return {
      filename: `${base}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: buildXlsx(definition.label, data.headers, data.rows),
    };
  }
  return {
    filename: `${base}.pdf`,
    mimeType: 'application/pdf',
    buffer: buildPdfDocument({
      title: `${definition.label} Export`,
      subtitle: `Generated ${new Date().toISOString()}`,
      metadata: [`${data.rows.length} records`],
      sections: [
        {
          heading: definition.label,
          lines: data.rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))).join(' | ')),
        },
      ],
    }),
  };
}

/**
 * Generates an export and stores it with a random download token. The token is
 * bound to the organization and creator; the download route re-checks both.
 */
export async function createExportJob(input: {
  organizationId: string;
  createdById: string;
  resourceType: string;
  format: string;
  filters?: Record<string, unknown>;
}) {
  const definition = getExportDefinition(input.resourceType);
  if (!definition) throw new ValidationError('This resource cannot be exported.');
  const format = assertFormat(input.format);
  const filters = input.filters ?? {};

  const job = await prisma.exportJob.create({
    data: {
      organizationId: input.organizationId,
      createdById: input.createdById,
      moduleKey: definition.moduleKey,
      resourceType: definition.resourceType,
      format,
      status: 'PROCESSING',
      fileName: `${definition.resourceType}.${format.toLowerCase()}`,
      filters: filters as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  try {
    const records = await definition.query(input.organizationId, filters);
    const rendered = renderExport(definition, format, {
      headers: definition.headers,
      rows: records.map(definition.mapRow),
    });

    await mkdir(EXPORT_DIRECTORY, { recursive: true });
    const token = randomBytes(24).toString('hex');
    const storagePath = path.join(EXPORT_DIRECTORY, `${token}-${rendered.filename}`);
    await writeFile(storagePath, rendered.buffer);

    return await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        fileName: rendered.filename,
        fileSize: rendered.buffer.length,
        storagePath,
        downloadToken: token,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        error: error instanceof Error ? error.message.slice(0, 500) : 'Export failed',
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

export async function downloadExportJob(input: {
  organizationId: string;
  userId: string;
  token: string;
}) {
  const job = await prisma.exportJob.findUnique({
    where: { downloadToken: input.token },
  });
  if (!job || job.organizationId !== input.organizationId || job.createdById !== input.userId) {
    throw new TenantScopeError();
  }
  if (job.status !== 'COMPLETED' || !job.storagePath) {
    throw new ValidationError('This export is no longer available.');
  }
  if (job.expiresAt && job.expiresAt.getTime() < Date.now()) {
    throw new ValidationError('This export link has expired.');
  }
  // Prevent path traversal from ever affecting the filesystem read.
  const resolved = path.resolve(job.storagePath);
  if (!resolved.startsWith(path.resolve(EXPORT_DIRECTORY) + path.sep)) {
    throw new TenantScopeError();
  }
  const buffer = await readFile(resolved);
  return { job, buffer };
}

export async function listExportJobs(organizationId: string, take = 50) {
  return prisma.exportJob.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

export async function deleteExportJob(organizationId: string, id: string) {
  const job = await prisma.exportJob.findFirst({ where: { id, organizationId } });
  if (!job) throw new TenantScopeError();
  if (job.storagePath) {
    const resolved = path.resolve(job.storagePath);
    if (resolved.startsWith(path.resolve(EXPORT_DIRECTORY) + path.sep)) {
      await unlink(resolved).catch(() => undefined);
    }
  }
  await prisma.exportJob.delete({ where: { id: job.id } });
}

export async function purgeExpiredExports() {
  const expired = await prisma.exportJob.findMany({
    where: { expiresAt: { lt: new Date() } },
    select: { id: true, storagePath: true },
  });
  for (const job of expired) {
    if (job.storagePath) {
      const resolved = path.resolve(job.storagePath);
      if (resolved.startsWith(path.resolve(EXPORT_DIRECTORY) + path.sep)) {
        await unlink(resolved).catch(() => undefined);
      }
    }
    await prisma.exportJob.update({
      where: { id: job.id },
      data: { status: 'EXPIRED', storagePath: null, downloadToken: null },
    });
  }
  return expired.length;
}

export async function getExportFileSize(storagePath: string): Promise<number> {
  const info = await stat(storagePath);
  return info.size;
}
