import { createHash, randomBytes } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdir, readFile, stat, unlink } from 'fs/promises';
import path from 'path';
import { prisma } from '@/core/db/prisma';
import { AuthorizationError, ValidationError } from '@/core/errors';

const execFileAsync = promisify(execFile);

export const BACKUP_DIRECTORY = path.join(process.cwd(), 'storage', 'backups');

export interface BackupPolicy {
  allowedEmails: string[];
  schedule: string;
  retentionDays: number;
  configured: boolean;
}

/**
 * Full-database backups are deliberately restricted to platform operators.
 * Tenant administrators cannot export data belonging to other organizations.
 */
export function getBackupPolicy(): BackupPolicy {
  const allowedEmails = (process.env.BACKUP_OPERATOR_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const schedule = (process.env.BACKUP_SCHEDULE ?? '0 2 * * *').trim();
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
  return {
    allowedEmails,
    schedule,
    retentionDays: Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 30,
    configured: allowedEmails.length > 0,
  };
}

export function assertBackupOperator(email: string): void {
  const policy = getBackupPolicy();
  if (!policy.configured) {
    throw new AuthorizationError(
      'Database backups are disabled. Configure BACKUP_OPERATOR_EMAILS to enable the operator workflow.',
    );
  }
  if (!policy.allowedEmails.includes(email.trim().toLowerCase())) {
    throw new AuthorizationError('Only authorized platform operators can manage database backups.');
  }
}

function parseDatabaseUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      throw new Error('Unsupported protocol');
    }
    return {
      host: decodeURIComponent(parsed.hostname),
      port: parsed.port || '5432',
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: decodeURIComponent(parsed.pathname.slice(1)),
    };
  } catch {
    throw new ValidationError('DATABASE_URL is not a valid PostgreSQL connection string.');
  }
}

/**
 * Creates a logical PostgreSQL backup using pg_dump. Arguments are passed as
 * an argv array (never through a shell), so connection values cannot inject
 * commands. The password is supplied via PGPASSWORD in the child environment.
 */
export async function createBackup(input: {
  operatorEmail: string;
  operatorUserId?: string | null;
  organizationId?: string | null;
  reason?: string;
}) {
  assertBackupOperator(input.operatorEmail);
  const connection = parseDatabaseUrl(process.env.DATABASE_URL ?? '');
  await mkdir(BACKUP_DIRECTORY, { recursive: true });

  const id = randomBytes(8).toString('hex');
  const fileName = `erm-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${id}.sql`;
  const storagePath = path.join(BACKUP_DIRECTORY, fileName);

  const record = await prisma.backupRecord.create({
    data: {
      organizationId: input.organizationId ?? null,
      status: 'RUNNING',
      fileName,
      createdById: input.operatorUserId ?? null,
      metadata: { reason: input.reason?.slice(0, 300) ?? null },
    },
  });

  try {
    const args = [
      '--host', connection.host,
      '--port', connection.port,
      '--username', connection.user,
      '--dbname', connection.database,
      '--no-password',
      '--format=custom',
      '--file', storagePath,
    ];
    await execFileAsync('pg_dump', args, {
      env: { ...process.env, PGPASSWORD: connection.password },
      timeout: 15 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const contents = await readFile(storagePath);
    const checksum = createHash('sha256').update(contents).digest('hex');
    const info = await stat(storagePath);

    return await prisma.backupRecord.update({
      where: { id: record.id },
      data: {
        status: 'COMPLETED',
        fileSize: BigInt(info.size),
        checksum,
        storagePath,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    await unlink(storagePath).catch(() => undefined);
    await prisma.backupRecord.update({
      where: { id: record.id },
      data: {
        status: 'FAILED',
        error: error instanceof Error ? error.message.slice(0, 500) : 'Backup failed',
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

export async function verifyBackup(input: {
  backupId: string;
  operatorEmail: string;
}) {
  assertBackupOperator(input.operatorEmail);
  const backup = await prisma.backupRecord.findUnique({ where: { id: input.backupId } });
  if (!backup) throw new ValidationError('Backup record not found.');
  if (!backup.storagePath || !backup.checksum) {
    throw new ValidationError('This backup has no verifiable artifact.');
  }
  const resolved = path.resolve(backup.storagePath);
  if (!resolved.startsWith(path.resolve(BACKUP_DIRECTORY) + path.sep)) {
    throw new ValidationError('Backup artifact path is invalid.');
  }
  const contents = await readFile(resolved);
  const checksum = createHash('sha256').update(contents).digest('hex');
  const verified = checksum === backup.checksum;
  if (verified) {
    await prisma.backupRecord.update({
      where: { id: backup.id },
      data: { status: 'VERIFIED' },
    });
  }
  return { verified, checksum };
}

export async function listBackups(operatorEmail: string, take = 50) {
  assertBackupOperator(operatorEmail);
  return prisma.backupRecord.findMany({
    orderBy: { startedAt: 'desc' },
    take,
  });
}

export async function deleteBackup(input: { backupId: string; operatorEmail: string }) {
  assertBackupOperator(input.operatorEmail);
  const backup = await prisma.backupRecord.findUnique({ where: { id: input.backupId } });
  if (!backup) throw new ValidationError('Backup record not found.');
  if (backup.storagePath) {
    const resolved = path.resolve(backup.storagePath);
    if (resolved.startsWith(path.resolve(BACKUP_DIRECTORY) + path.sep)) {
      await unlink(resolved).catch(() => undefined);
    }
  }
  await prisma.backupRecord.delete({ where: { id: backup.id } });
}

export async function purgeOldBackups() {
  const policy = getBackupPolicy();
  const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);
  const old = await prisma.backupRecord.findMany({
    where: { startedAt: { lt: cutoff } },
    select: { id: true, storagePath: true },
  });
  for (const backup of old) {
    if (backup.storagePath) {
      const resolved = path.resolve(backup.storagePath);
      if (resolved.startsWith(path.resolve(BACKUP_DIRECTORY) + path.sep)) {
        await unlink(resolved).catch(() => undefined);
      }
    }
    await prisma.backupRecord.delete({ where: { id: backup.id } });
  }
  return old.length;
}

/**
 * Documents the restore workflow. Restores are intentionally not exposed as a
 * dashboard action: restoring a full database over a live tenant is a
 * destructive operator procedure performed from the CLI with pg_restore.
 */
export function restoreInstructions(backupId: string): string[] {
  return [
    `1. Stop application writes (maintenance window) and verify backup ${backupId}.`,
    '2. Take a final pre-restore backup with createBackup().',
    '3. Run: pg_restore --clean --if-exists --dbname="$DATABASE_URL" storage/backups/<verified-file>.',
    '4. Run: npx prisma migrate deploy to confirm the schema matches migrations.',
    '5. Re-heat caches, revoke all active sessions, and re-enable writes.',
    '6. Record the restore in the AuditLog with the operator identity.',
  ];
}
