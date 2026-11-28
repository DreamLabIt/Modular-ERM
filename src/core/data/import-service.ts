import type { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { TenantScopeError, ValidationError } from '@/core/errors';
import { parseCsv, detectFileFormat, type ParsedTable } from './csv';
import { parseXlsx } from './xlsx';
import {
  getImportDefinition,
  suggestMapping,
  applyMapping,
  type ImportRowResult,
} from './import-definitions';

export interface ImportError {
  row: number;
  errors: string[];
}

export interface ImportPreview {
  headers: string[];
  mapping: Record<string, string>;
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: ImportError[];
  samples: Array<Record<string, string>>;
}

function parseFile(fileName: string, bytes: Buffer): ParsedTable {
  const format = detectFileFormat(fileName);
  return format === 'CSV' ? parseCsv(bytes.toString('utf8')) : parseXlsx(bytes);
}

class RollbackPreview extends Error {}

/**
 * Validates a preview in a transaction that is always rolled back. This lets
 * the same strict row-level validators used for real imports detect duplicate
 * and invalid records without writing anything to the database.
 */
async function validateRows(
  organizationId: string,
  definitionId: string,
  rows: Array<Record<string, string>>,
  mapping: Record<string, string>,
  rollback: boolean,
): Promise<{ results: ImportRowResult[]; errors: ImportError[] }> {
  const definition = getImportDefinition(definitionId);
  if (!definition) throw new ValidationError('Unknown import resource.');

  let captured: { results: ImportRowResult[]; errors: ImportError[] } | undefined;
  const work = async (tx: Prisma.TransactionClient) => {
    const results: ImportRowResult[] = [];
    const errors: ImportError[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const mapped = applyMapping(rows[index], mapping);
      const result = await definition.createRow(tx, organizationId, mapped);
      results.push(result);
      if (!result.ok) {
        errors.push({ row: index + 2, errors: result.errors });
      }
    }
    const value = { results, errors };
    if (rollback) {
      captured = value;
      // Deliberate rollback so previews never mutate business data.
      throw new RollbackPreview();
    }
    return value;
  };

  if (rollback) {
    try {
      await prisma.$transaction(work, { maxWait: 10000, timeout: 120000 });
    } catch (error) {
      if (error instanceof RollbackPreview && captured) return captured;
      throw error;
    }
  }
  const committed = await prisma.$transaction(work, { maxWait: 10000, timeout: 300000 });
  return committed ?? { results: [], errors: [] };
}

export async function previewImport(input: {
  organizationId: string;
  createdById: string;
  resourceType: string;
  fileName: string;
  fileSize: number;
  bytes: Buffer;
  mapping?: Record<string, string>;
}) {
  const definition = getImportDefinition(input.resourceType);
  if (!definition) throw new ValidationError('This resource cannot be imported.');
  if (input.fileSize > 10 * 1024 * 1024) {
    throw new ValidationError('Uploaded files must be 10 MB or smaller.');
  }

  const table = parseFile(input.fileName, input.bytes);
  if (table.rows.length === 0) throw new ValidationError('The file contains no data rows.');
  if (table.rows.length > 5000) {
    throw new ValidationError('Imports are limited to 5,000 rows per file.');
  }

  const mapping = input.mapping ?? suggestMapping(table.headers, definition);
  const missing = definition.columns.filter((column) => column.required && !mapping[column.key]);
  if (missing.length > 0) {
    throw new ValidationError(
      `Missing required columns: ${missing.map((column) => column.label).join(', ')}.`,
    );
  }

  // Preview uses the same validators but never persists records.
  const result = await validateRows(
    input.organizationId,
    input.resourceType,
    table.rows,
    mapping,
    true,
  );

  const created = result.results.filter((row) => row.action === 'CREATE').length;
  const skipped = result.results.filter((row) => row.action === 'SKIP_DUPLICATE').length;
  const job = await prisma.importJob.create({
    data: {
      organizationId: input.organizationId,
      createdById: input.createdById,
      moduleKey: definition.moduleKey,
      resourceType: input.resourceType,
      fileName: input.fileName.slice(0, 200),
      fileSize: input.fileSize,
      fileFormat: detectFileFormat(input.fileName),
      status: 'PREVIEW',
      totalRows: table.rows.length,
      successRows: created,
      errorRows: result.errors.length,
      mapping: mapping as Prisma.InputJsonValue,
      summary: {
        headers: table.headers,
        rows: table.rows,
        created,
        skipped,
        errors: result.errors,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return {
    job,
    preview: {
      headers: table.headers,
      mapping,
      totalRows: table.rows.length,
      validRows: created + skipped,
      errorRows: result.errors.length,
      errors: result.errors,
      samples: table.rows.slice(0, 5),
    } satisfies ImportPreview,
  };
}

export async function executeImport(input: {
  organizationId: string;
  actorUserId: string;
  jobId: string;
}) {
  const job = await prisma.importJob.findFirst({
    where: { id: input.jobId, organizationId: input.organizationId },
  });
  if (!job) throw new TenantScopeError();
  if (job.status !== 'PREVIEW') throw new ValidationError('This preview has already been processed.');
  if (job.summary && typeof job.summary === 'object' && !Array.isArray(job.summary)) {
    const summary = job.summary as { rows?: Array<Record<string, string>> };
    if (!summary.rows || summary.rows.length === 0) {
      throw new ValidationError('This preview contains no rows to import.');
    }
  }

  const definition = getImportDefinition(job.resourceType);
  if (!definition) throw new ValidationError('Unknown import resource.');

  await prisma.importJob.update({
    where: { id: job.id },
    data: { status: 'PROCESSING' },
  });

  try {
    const summary = job.summary as {
      rows: Array<Record<string, string>>;
    } | null;
    const mapping = (job.mapping ?? {}) as Record<string, string>;
    const result = await validateRows(
      input.organizationId,
      job.resourceType,
      summary?.rows ?? [],
      mapping,
      false,
    );
    const created = result.results.filter((row) => row.action === 'CREATE').length;
    const skipped = result.results.filter((row) => row.action === 'SKIP_DUPLICATE').length;

    const updated = await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        processedRows: result.results.length,
        successRows: created,
        errorRows: result.errors.length,
        errors: result.errors as unknown as Prisma.InputJsonValue,
        summary: {
          created,
          skipped,
          failed: result.errors.length,
        } as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    return { job: updated, created, skipped, errors: result.errors };
  } catch (error) {
    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        errorRows: job.totalRows,
        summary: {
          error: error instanceof Error ? error.message.slice(0, 500) : 'Import failed',
        } as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

export async function cancelImportJob(organizationId: string, id: string) {
  const job = await prisma.importJob.findFirst({
    where: { id, organizationId, status: 'PREVIEW' },
  });
  if (!job) throw new TenantScopeError();
  return prisma.importJob.update({
    where: { id: job.id },
    data: { status: 'CANCELLED', completedAt: new Date() },
  });
}

export async function listImportJobs(organizationId: string, take = 50) {
  return prisma.importJob.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

export async function getImportJob(organizationId: string, id: string) {
  const job = await prisma.importJob.findFirst({ where: { id, organizationId } });
  if (!job) throw new TenantScopeError();
  return job;
}
