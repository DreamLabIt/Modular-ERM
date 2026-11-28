import assert from 'node:assert/strict';
import 'dotenv/config';
import test from 'node:test';
import { prisma } from '@/core/db/prisma';
import { evaluateConditions, validateConditionNode } from '@/core/workflows/conditions';
import { sanitizeAuditPayload, recordAuditLog, searchAuditLogs } from '@/core/audit';
import { checkRateLimit } from '@/core/security/rate-limit';
import {
  createUserSession,
  validateSessionToken,
  revokeSessionById,
} from '@/core/security/sessions';
import { createWorkflow } from '@/core/workflows/management';
import {
  approveRequest,
  rejectRequest,
  createApprovalDelegation,
} from '@/core/workflows/engine';
import { allocateDocumentNumber } from '@/core/settings/document-numbering';
import { getOrganizationSettings, assertValidOrganizationSettings } from '@/core/settings';
import { parseCsv } from '@/core/data/csv';
import { buildXlsx } from '@/core/data/xlsx-writer';
import { parseXlsx } from '@/core/data/xlsx';
import { previewImport, executeImport } from '@/core/data/import-service';
import { upsertRetentionPolicy, runRetentionPolicies } from '@/core/data/retention';
import { archiveRecord, restoreRecord } from '@/core/data/archive';

async function isDbAvailable(): Promise<boolean> {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

const itDb = (name: string, fn: () => Promise<void>) =>
  test(name, async (t) => {
    if (!(await isDbAvailable())) {
      t.skip('Database unavailable');
      return;
    }
    await fn();
  });

interface Ctx {
  organizationId: string;
  adminId: string;
  managerId: string;
  employeeId: string;
  managerRoleId: string;
  employeeRoleId: string;
}

async function setup(prefix: string): Promise<Ctx> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const organization = await prisma.organization.create({
    data: { name: `${prefix} ${stamp}`, slug: `${prefix}-${stamp}` },
  });
  const adminRole = await prisma.role.create({
    data: { organizationId: organization.id, name: 'Admin', permissions: ['*'] },
  });
  const managerRole = await prisma.role.create({
    data: { organizationId: organization.id, name: 'Manager', permissions: ['workflow.approve'] },
  });
  const employeeRole = await prisma.role.create({
    data: { organizationId: organization.id, name: 'Employee', permissions: ['workflow.view'] },
  });
  const admin = await prisma.user.create({
    data: {
      organizationId: organization.id,
      roleId: adminRole.id,
      name: 'Admin',
      email: `${prefix}-admin-${stamp}@local.test`,
      passwordHash: 'hash',
    },
  });
  const manager = await prisma.user.create({
    data: {
      organizationId: organization.id,
      roleId: managerRole.id,
      name: 'Manager',
      email: `${prefix}-manager-${stamp}@local.test`,
      passwordHash: 'hash',
    },
  });
  const employee = await prisma.user.create({
    data: {
      organizationId: organization.id,
      roleId: employeeRole.id,
      name: 'Employee',
      email: `${prefix}-employee-${stamp}@local.test`,
      passwordHash: 'hash',
    },
  });
  return {
    organizationId: organization.id,
    adminId: admin.id,
    managerId: manager.id,
    employeeId: employee.id,
    managerRoleId: managerRole.id,
    employeeRoleId: employeeRole.id,
  };
}

async function cleanup(ctx: Ctx) {
  await prisma.organization.deleteMany({ where: { id: ctx.organizationId } });
  await prisma.rateLimitBucket.deleteMany({
    where: { key: { startsWith: 'test-rate-limit' } },
  });
}

test('workflow conditions are structured data and never execute code', () => {
  assert.equal(
    evaluateConditions(
      { all: [{ field: 'amount', operator: 'gte', value: 100 }, { field: 'currency', operator: 'eq', value: 'BDT' }] },
      { amount: 250, currency: 'BDT' },
    ),
    true,
  );
  assert.equal(
    evaluateConditions({ any: [{ field: 'amount', operator: 'gt', value: 1000 }, { field: 'currency', operator: 'contains', value: 'BD' }] }, { amount: 100, currency: 'BDT' }),
    true,
  );
  assert.equal(evaluateConditions({ not: { field: 'blocked', operator: 'eq', value: true } }, { blocked: false }), true);
  assert.equal(evaluateConditions({ field: 'amount', operator: 'in', value: [10, 20] }, { amount: 20 }), true);
  assert.equal(evaluateConditions({ field: '__proto__.polluted', operator: 'eq', value: true }, {}), false);
  assert.throws(() => validateConditionNode({ field: 'x', operator: 'eval', value: 'process.exit()' }));
});

test('audit payload sanitization redacts secrets recursively', () => {
  const sanitized = sanitizeAuditPayload({
    password: 'secret',
    nested: { apiKey: 'abc', passwordHash: 'xyz', safe: 'visible' },
    list: [{ token: 'jwt', value: 1 }],
  }) as Record<string, unknown>;
  assert.equal(sanitized.password, '[redacted]');
  const nested = sanitized.nested as Record<string, unknown>;
  assert.equal(nested.apiKey, '[redacted]');
  assert.equal(nested.passwordHash, '[redacted]');
  assert.equal(nested.safe, 'visible');
  assert.equal(((sanitized.list as Array<Record<string, unknown>>)[0]).token, '[redacted]');
});

test('CSV parsing and XLSX round-trip preserve values without evaluating formulas', () => {
  const table = parseCsv('name,amount\n"Acme, Ltd",150\nBad,=SUM(A1:A2)\n');
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0].name, 'Acme, Ltd');
  assert.equal(table.rows[1].amount, '=SUM(A1:A2)');

  const workbook = buildXlsx('Export', ['Name', 'Amount'], [['Acme', 150], ['=1+1', 200]]);
  const parsed = parseXlsx(workbook);
  assert.deepEqual(parsed.headers, ['name', 'amount']);
  assert.equal(parsed.rows[0].amount, '150');
  assert.equal(parsed.rows[1].name, "'=1+1");
});

test('settings validation rejects invalid timezone, currency and formats', () => {
  assert.doesNotThrow(() => assertValidOrganizationSettings({ currencyCode: 'USD', timezone: 'Asia/Dhaka', dateFormat: 'DD/MM/YYYY' }));
  assert.throws(() => assertValidOrganizationSettings({ currencyCode: 'INVALID' }));
  assert.throws(() => assertValidOrganizationSettings({ timezone: 'Mars/Olympus' }));
  assert.throws(() => assertValidOrganizationSettings({ dateFormat: 'MM-DD-YYYY' }));
});

itDb('database rate limiter counts attempts and blocks above the limit', async () => {
  const key = `test-rate-limit:${Date.now()}`;
  const first = await checkRateLimit(key, { limit: 2, windowSeconds: 60 });
  await checkRateLimit(key, { limit: 2, windowSeconds: 60 });
  const third = await checkRateLimit(key, { limit: 2, windowSeconds: 60 });
  assert.equal(first.backend, 'database');
  assert.equal(first.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
});

itDb('session revocation takes effect on token validation', async () => {
  const ctx = await setup('session-test');
  try {
    const { tokenId, session } = await createUserSession({
      organizationId: ctx.organizationId,
      userId: ctx.adminId,
    });
    assert.equal((await validateSessionToken(tokenId)).valid, true);
    assert.equal(await revokeSessionById(ctx.organizationId, session.id, ctx.adminId), true);
    const after = await validateSessionToken(tokenId);
    assert.equal(after.valid, false);
    assert.equal(after.reason, 'REVOKED');
  } finally {
    await cleanup(ctx);
  }
});

itDb('audit logs are written with tenant scope and searchable', async () => {
  const ctx = await setup('audit-test');
  try {
    await recordAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.adminId,
      action: 'TEST_ACTION',
      resource: 'TEST_RESOURCE',
      description: 'Test audit entry',
      after: { password: 'should-be-redacted', value: 1 },
    });
    const result = await searchAuditLogs({ organizationId: ctx.organizationId, action: 'TEST_ACTION' });
    assert.equal(result.total, 1);
    const values = result.rows[0].newValues as { password: string; value: number };
    assert.equal(values.password, '[redacted]');
    assert.equal(values.value, 1);
  } finally {
    await cleanup(ctx);
  }
});

itDb('document numbers are unique under concurrent allocation', async () => {
  const ctx = await setup('numbering-test');
  try {
    const numbers = await Promise.all(
      Array.from({ length: 12 }, () =>
        prisma.$transaction((tx) => allocateDocumentNumber(tx, ctx.organizationId, 'PURCHASE_ORDER')),
      ),
    );
    assert.equal(new Set(numbers).size, 12);
    assert.ok(numbers.every((number) => number.startsWith('PO-')));
  } finally {
    await cleanup(ctx);
  }
});

itDb('workflow supports sequential steps, delegation and rejection reasons', async () => {
  const ctx = await setup('workflow-test');
  try {
    const workflow = await createWorkflow({
      organizationId: ctx.organizationId,
      actorUserId: ctx.adminId,
      workflow: {
        name: 'Two-level approval',
        moduleKey: 'hrm',
        resourceType: 'LEAVE_REQUEST',
        isActive: true,
        conditions: { field: 'days', operator: 'gte', value: 1 },
        steps: [
          {
            stepOrder: 1,
            name: 'Manager',
            approvalMode: 'SEQUENTIAL',
            minApprovals: 1,
            approverRoleId: ctx.managerRoleId,
            dueInHours: 48,
          },
          {
            stepOrder: 2,
            name: 'HR',
            approvalMode: 'SEQUENTIAL',
            minApprovals: 1,
            approverUserId: ctx.adminId,
          },
        ],
      },
    });
    assert.equal(workflow.steps.length, 2);

    const leave = await prisma.leaveRequest.create({
      data: {
        organizationId: ctx.organizationId,
        employeeId: (
          await prisma.employee.create({
            data: {
              organizationId: ctx.organizationId,
              employeeCode: `EMP-${Date.now()}`,
              fullName: 'Test Employee',
              designation: 'Developer',
              department: ' Engineering',
              joiningDate: new Date(),
              basicSalary: 1000,
              userId: ctx.employeeId,
            },
          })
        ).id,
        leaveType: 'CASUAL',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-02'),
        days: 2,
      },
    });

    const { startApproval } = await import('@/core/workflows/engine');
    const started = await startApproval({
      organizationId: ctx.organizationId,
      moduleKey: 'hrm',
      resourceType: 'LEAVE_REQUEST',
      resourceId: leave.id,
      title: 'Two day leave',
      requesterId: ctx.employeeId,
      payload: { days: 2 },
    });
    if (!started.success) throw new Error(started.error);
    const requestId = started.data.requestId;

    const delegation = await createApprovalDelegation({
      organizationId: ctx.organizationId,
      fromUserId: ctx.managerId,
      toUserId: ctx.employeeId,
      startDate: new Date(Date.now() - 60_000),
      endDate: new Date(Date.now() + 60 * 60 * 1000),
      reason: 'Manager on leave',
      createdById: ctx.adminId,
    });
    assert.equal(delegation.success, true);

    const stepOne = await prisma.approvalRequestStep.findFirstOrThrow({
      where: { requestId, stepOrder: 1 },
    });
    assert.ok(stepOne.dueAt);

    const first = await approveRequest({
      organizationId: ctx.organizationId,
      requestId,
      actorUserId: ctx.managerId,
      comment: 'Approved by manager',
    });
    assert.equal(first.success, true);
    assert.equal(first.data?.status, 'PENDING');
    assert.equal(first.data?.currentStep, 2);

    const unauthorized = await approveRequest({
      organizationId: ctx.organizationId,
      requestId,
      actorUserId: ctx.managerId,
    });
    assert.equal(unauthorized.success, false);

    const noReason = await rejectRequest({
      organizationId: ctx.organizationId,
      requestId,
      actorUserId: ctx.adminId,
      comment: '   ',
    });
    assert.equal(noReason.success, false, 'rejection requires a reason');

    const final = await approveRequest({
      organizationId: ctx.organizationId,
      requestId,
      actorUserId: ctx.adminId,
      comment: 'HR approved',
    });
    assert.equal(final.success, true);
    assert.equal(final.data?.status, 'APPROVED');
    const updatedLeave = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } });
    assert.equal(updatedLeave.status, 'APPROVED');
    const actions = await prisma.approvalAction.count({ where: { requestId } });
    assert.ok(actions >= 3);
  } finally {
    await cleanup(ctx);
  }
});

itDb('rejection requires a reason and updates business state atomically', async () => {
  const ctx = await setup('reject-test');
  try {
    await createWorkflow({
      organizationId: ctx.organizationId,
      actorUserId: ctx.adminId,
      workflow: {
        name: 'Manager approval',
        moduleKey: 'hrm',
        resourceType: 'LEAVE_REQUEST',
        isActive: true,
        steps: [
          {
            stepOrder: 1,
            name: 'Manager',
            approvalMode: 'SEQUENTIAL',
            minApprovals: 1,
            approverRoleId: ctx.managerRoleId,
          },
        ],
      },
    });
    const employee = await prisma.employee.create({
      data: {
        organizationId: ctx.organizationId,
        employeeCode: `EMP-${Date.now()}`,
        fullName: 'Reject Employee',
        designation: 'Developer',
        department: 'Engineering',
        joiningDate: new Date(),
        basicSalary: 1000,
        userId: ctx.employeeId,
      },
    });
    const leave = await prisma.leaveRequest.create({
      data: {
        organizationId: ctx.organizationId,
        employeeId: employee.id,
        leaveType: 'CASUAL',
        startDate: new Date('2026-02-01'),
        endDate: new Date('2026-02-02'),
        days: 2,
      },
    });
    const { startApproval } = await import('@/core/workflows/engine');
    const started = await startApproval({
      organizationId: ctx.organizationId,
      moduleKey: 'hrm',
      resourceType: 'LEAVE_REQUEST',
      resourceId: leave.id,
      title: 'Rejection test',
      requesterId: ctx.employeeId,
      payload: {},
    });
    if (!started.success) throw new Error(started.error);
    const requestId = started.data.requestId;

    const noReason = await rejectRequest({
      organizationId: ctx.organizationId,
      requestId,
      actorUserId: ctx.managerId,
      comment: '   ',
    });
    assert.equal(noReason.success, false);

    const rejected = await rejectRequest({
      organizationId: ctx.organizationId,
      requestId,
      actorUserId: ctx.managerId,
      comment: 'Not enough balance',
    });
    assert.equal(rejected.success, true);
    const updated = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } });
    assert.equal(updated.status, 'REJECTED');
    assert.equal(updated.rejectionReason, 'Not enough balance');
  } finally {
    await cleanup(ctx);
  }
});

itDb('import preview rolls back and execute persists validated rows', async () => {
  const ctx = await setup('import-test');
  try {
    const csv = 'name,email\nPreview Customer,preview@example.com\n';
    const preview = await previewImport({
      organizationId: ctx.organizationId,
      createdById: ctx.adminId,
      resourceType: 'customers',
      fileName: 'customers.csv',
      fileSize: Buffer.byteLength(csv),
      bytes: Buffer.from(csv),
    });
    assert.equal(preview.preview.totalRows, 1);
    assert.equal(await prisma.customer.count({ where: { organizationId: ctx.organizationId } }), 0);

    const executed = await executeImport({
      organizationId: ctx.organizationId,
      actorUserId: ctx.adminId,
      jobId: preview.job.id,
    });
    assert.equal(executed.created, 1);
    assert.equal(await prisma.customer.count({ where: { organizationId: ctx.organizationId } }), 1);
  } finally {
    await cleanup(ctx);
  }
});

itDb('retention legal hold skips deletion and archive restore is reversible', async () => {
  const ctx = await setup('retention-test');
  try {
    await getOrganizationSettings(ctx.organizationId);
    await upsertRetentionPolicy({
      organizationId: ctx.organizationId,
      dataType: 'NOTIFICATION_HISTORY',
      retentionDays: 30,
      action: 'DELETE',
      isActive: true,
      legalHold: true,
    });
    await upsertRetentionPolicy({
      organizationId: ctx.organizationId,
      dataType: 'AUDIT_LOG',
      retentionDays: 30,
      action: 'DELETE',
      isActive: true,
    });
    const oldNotification = await prisma.notification.create({
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.adminId,
        title: 'Old notification',
        message: 'Should survive legal hold',
        createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      },
    });
    const summary = await runRetentionPolicies({
      organizationId: ctx.organizationId,
      actorUserId: ctx.adminId,
    });
    // Legal-hold policies are skipped entirely rather than partially applied.
    assert.equal(summary.some((entry) => entry.dataType === 'NOTIFICATION_HISTORY'), false);
    assert.equal(summary.some((entry) => entry.dataType === 'AUDIT_LOG'), true);
    assert.ok(await prisma.notification.findUnique({ where: { id: oldNotification.id } }));

    const customer = await prisma.customer.create({
      data: { organizationId: ctx.organizationId, name: 'Archive Me' },
    });
    const archived = await archiveRecord({
      organizationId: ctx.organizationId,
      actorUserId: ctx.adminId,
      resourceType: 'CUSTOMER',
      resourceId: customer.id,
      reason: 'No longer active',
    });
    assert.ok(archived.snapshot);
    const archivedCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.ok(archivedCustomer.archivedAt);
    await restoreRecord({
      organizationId: ctx.organizationId,
      actorUserId: ctx.adminId,
      archiveId: archived.id,
    });
    const restored = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(restored.archivedAt, null);
  } finally {
    await cleanup(ctx);
  }
});
