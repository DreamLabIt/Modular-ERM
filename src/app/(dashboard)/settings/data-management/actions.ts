'use server';

import { guardedAction } from '@/core/auth/action';
import { ValidationError } from '@/core/errors';
import { previewImport, executeImport, cancelImportJob } from '@/core/data/import-service';
import { createExportJob, deleteExportJob } from '@/core/data/export';
import { createBackup, verifyBackup, deleteBackup } from '@/core/data/backup';
import { archiveRecord, restoreRecord } from '@/core/data/archive';
import { upsertRetentionPolicy, runRetentionPolicies } from '@/core/data/retention';

const REDIRECT = '/settings/data-management';

function bool(value: FormDataEntryValue | null): boolean {
  return value === 'on' || value === 'true' || value === '1';
}

export async function previewImportAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'data.import',
    revalidate: REDIRECT,
    redirectTo: REDIRECT,
    successMessage: 'Preview ready. Review the rows before importing.',
  }, async (tenant) => {
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      throw new ValidationError('Choose a CSV or XLSX file to upload.');
    }
    await previewImport({
      organizationId: tenant.organizationId,
      createdById: tenant.userId,
      resourceType: String(formData.get('resourceType') || ''),
      fileName: file.name,
      fileSize: file.size,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
  });
}

export async function executeImportAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'data.import',
    revalidate: REDIRECT,
    redirectTo: REDIRECT,
    successMessage: 'Import completed. Check the job summary for details.',
  }, async (tenant) => {
    await executeImport({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      jobId: String(formData.get('jobId') || ''),
    });
  });
}

export async function cancelImportAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'data.import',
    revalidate: REDIRECT,
    redirectTo: REDIRECT,
    successMessage: 'Import preview cancelled.',
  }, async (tenant) => {
    await cancelImportJob(tenant.organizationId, String(formData.get('jobId') || ''));
  });
}

export async function createExportAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'data.export',
    revalidate: REDIRECT,
    redirectTo: REDIRECT,
    successMessage: 'Export generated. Use the download link below.',
  }, async (tenant) => {
    const filters: Record<string, unknown> = {};
    for (const key of ['from', 'to', 'status', 'search']) {
      const value = String(formData.get(key) || '').trim();
      if (value) filters[key] = value;
    }
    await createExportJob({
      organizationId: tenant.organizationId,
      createdById: tenant.userId,
      resourceType: String(formData.get('resourceType') || ''),
      format: String(formData.get('format') || 'CSV'),
      filters,
    });
  });
}

export async function deleteExportAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'data.export',
    revalidate: REDIRECT,
    redirectTo: REDIRECT,
    successMessage: 'Export deleted.',
  }, async (tenant) => {
    await deleteExportJob(tenant.organizationId, String(formData.get('id') || ''));
  });
}

export async function createBackupAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'data.backup.manage',
    revalidate: REDIRECT,
    redirectTo: REDIRECT,
    successMessage: 'Backup completed and checksummed.',
  }, async (tenant) => {
    await createBackup({
      operatorEmail: tenant.email,
      operatorUserId: tenant.userId,
      reason: String(formData.get('reason') || '') || undefined,
    });
  });
}

export async function verifyBackupAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'data.backup.manage',
    revalidate: REDIRECT,
    redirectTo: REDIRECT,
    successMessage: 'Backup checksum verified.',
  }, async (tenant) => {
    const result = await verifyBackup({
      backupId: String(formData.get('id') || ''),
      operatorEmail: tenant.email,
    });
    if (!result.verified) throw new ValidationError('Backup checksum does not match. Do not rely on this backup.');
  });
}

export async function deleteBackupAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'data.backup.manage',
    revalidate: REDIRECT,
    redirectTo: REDIRECT,
    successMessage: 'Backup deleted.',
  }, async (tenant) => {
    await deleteBackup({
      backupId: String(formData.get('id') || ''),
      operatorEmail: tenant.email,
    });
  });
}

export async function archiveRecordAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'data.archive.manage',
    revalidate: REDIRECT,
    redirectTo: REDIRECT,
    successMessage: 'Record archived.',
  }, async (tenant) => {
    await archiveRecord({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      resourceType: String(formData.get('resourceType') || ''),
      resourceId: String(formData.get('resourceId') || ''),
      reason: String(formData.get('reason') || '') || undefined,
    });
  });
}

export async function restoreRecordAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'data.archive.manage',
    revalidate: REDIRECT,
    redirectTo: REDIRECT,
    successMessage: 'Record restored.',
  }, async (tenant) => {
    await restoreRecord({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      archiveId: String(formData.get('id') || ''),
    });
  });
}

export async function saveRetentionPolicyAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'data.retention.manage',
    revalidate: REDIRECT,
    redirectTo: REDIRECT,
    successMessage: 'Retention policy saved.',
  }, async (tenant) => {
    await upsertRetentionPolicy({
      organizationId: tenant.organizationId,
      dataType: String(formData.get('dataType') || ''),
      retentionDays: Number(formData.get('retentionDays')),
      action: String(formData.get('action') || 'DELETE'),
      isActive: bool(formData.get('isActive')),
      legalHold: bool(formData.get('legalHold')),
    });
  });
}

export async function runRetentionAction(): Promise<void> {
  await guardedAction({
    permission: 'data.retention.manage',
    revalidate: REDIRECT,
    redirectTo: REDIRECT,
    successMessage: 'Retention policies applied.',
  }, async (tenant) => {
    await runRetentionPolicies({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
    });
  });
}
