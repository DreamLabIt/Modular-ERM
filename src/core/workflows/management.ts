import { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { TenantScopeError, ValidationError } from '@/core/errors';
import { validateConditionNode } from './conditions';
import { recordAuditLog } from '@/core/audit';

export interface WorkflowStepInput {
  id?: string;
  stepOrder: number;
  name: string;
  approvalMode: string;
  minApprovals: number;
  approverRoleId?: string | null;
  approverUserId?: string | null;
  fallbackRoleId?: string | null;
  dueInHours?: number | null;
  condition?: unknown;
}

export interface WorkflowInput {
  name: string;
  description?: string;
  moduleKey: string;
  resourceType: string;
  conditions?: unknown;
  isActive: boolean;
  steps: WorkflowStepInput[];
}

const APPROVAL_MODES = ['SEQUENTIAL', 'PARALLEL'];

function assertWorkflowInput(input: WorkflowInput) {
  if (!input.name.trim() || input.name.trim().length > 120) {
    throw new ValidationError('Workflow name must be between 1 and 120 characters.');
  }
  if (!input.moduleKey.trim() || !input.resourceType.trim()) {
    throw new ValidationError('Module and resource type are required.');
  }
  if (!Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > 20) {
    throw new ValidationError('A workflow must have between 1 and 20 approval steps.');
  }
  if (new Set(input.steps.map((step) => step.stepOrder)).size !== input.steps.length) {
    throw new ValidationError('Step order values must be unique.');
  }
  for (const step of input.steps) {
    if (!step.name.trim()) throw new ValidationError('Every step needs a name.');
    if (!APPROVAL_MODES.includes(step.approvalMode)) {
      throw new ValidationError('Unsupported approval mode.');
    }
    if (!Number.isInteger(step.minApprovals) || step.minApprovals < 1 || step.minApprovals > 50) {
      throw new ValidationError('Minimum approvals must be between 1 and 50.');
    }
    if (!step.approverRoleId && !step.approverUserId && !step.fallbackRoleId) {
      throw new ValidationError('Every step needs at least one approver role or user.');
    }
    if (step.condition) validateConditionNode(step.condition);
  }
  if (input.conditions) validateConditionNode(input.conditions);
}

async function assertReferences(
  organizationId: string,
  roleIds: Array<string | null | undefined>,
  userIds: Array<string | null | undefined>,
) {
  const uniqueRoles = Array.from(new Set(roleIds.filter((id): id is string => Boolean(id))));
  const uniqueUsers = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))));
  const [roles, users] = await Promise.all([
    prisma.role.findMany({ where: { id: { in: uniqueRoles }, organizationId }, select: { id: true } }),
    prisma.user.findMany({ where: { id: { in: uniqueUsers }, organizationId }, select: { id: true } }),
  ]);
  if (roles.length !== uniqueRoles.length || users.length !== uniqueUsers.length) {
    throw new ValidationError('One or more approver roles or users do not belong to this organization.');
  }
}

export async function createWorkflow(input: {
  organizationId: string;
  actorUserId: string;
  workflow: WorkflowInput;
}) {
  assertWorkflowInput(input.workflow);
  await assertReferences(
    input.organizationId,
    input.workflow.steps.flatMap((step) => [step.approverRoleId, step.fallbackRoleId]),
    input.workflow.steps.map((step) => step.approverUserId),
  );

  const workflow = await prisma.$transaction(async (tx) => {
    const created = await tx.approvalWorkflow.create({
      data: {
        organizationId: input.organizationId,
        name: input.workflow.name.trim(),
        description: input.workflow.description?.trim() || null,
        moduleKey: input.workflow.moduleKey.trim(),
        resourceType: input.workflow.resourceType.trim(),
        conditions: input.workflow.conditions
          ? (input.workflow.conditions as Prisma.InputJsonValue)
          : undefined,
        isActive: Boolean(input.workflow.isActive),
        createdById: input.actorUserId,
        steps: {
          create: input.workflow.steps.map((step) => ({
            stepOrder: step.stepOrder,
            name: step.name.trim(),
            approvalMode: step.approvalMode,
            minApprovals: step.minApprovals,
            approverRoleId: step.approverRoleId ?? null,
            approverUserId: step.approverUserId ?? null,
            fallbackRoleId: step.fallbackRoleId ?? null,
            dueInHours: step.dueInHours ?? null,
            condition: step.condition ? (step.condition as Prisma.InputJsonValue) : undefined,
          })),
        },
      },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'WORKFLOW_CREATED',
        resource: 'APPROVAL_WORKFLOW',
        resourceId: created.id,
        description: `Created approval workflow "${created.name}".`,
        after: { name: created.name, moduleKey: created.moduleKey, resourceType: created.resourceType },
      },
      tx,
    );
    return created;
  });
  return workflow;
}

export async function updateWorkflow(input: {
  organizationId: string;
  actorUserId: string;
  workflowId: string;
  workflow: WorkflowInput;
}) {
  assertWorkflowInput(input.workflow);
  const existing = await prisma.approvalWorkflow.findFirst({
    where: { id: input.workflowId, organizationId: input.organizationId },
    include: { _count: { select: { requests: true } } },
  });
  if (!existing) throw new TenantScopeError();
  if (existing._count.requests > 0) {
    // Never rewrite history for in-flight or completed requests: publish a new version.
    return createWorkflow({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      workflow: { ...input.workflow, name: `${input.workflow.name.trim()} (v${existing.version + 1})` },
    });
  }

  await assertReferences(
    input.organizationId,
    input.workflow.steps.flatMap((step) => [step.approverRoleId, step.fallbackRoleId]),
    input.workflow.steps.map((step) => step.approverUserId),
  );

  return prisma.$transaction(async (tx) => {
    const updated = await tx.approvalWorkflow.update({
      where: { id: existing.id },
      data: {
        name: input.workflow.name.trim(),
        description: input.workflow.description?.trim() || null,
        moduleKey: input.workflow.moduleKey.trim(),
        resourceType: input.workflow.resourceType.trim(),
        conditions: input.workflow.conditions
          ? (input.workflow.conditions as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        isActive: Boolean(input.workflow.isActive),
        version: { increment: 1 },
        steps: {
          deleteMany: {},
          create: input.workflow.steps.map((step) => ({
            stepOrder: step.stepOrder,
            name: step.name.trim(),
            approvalMode: step.approvalMode,
            minApprovals: step.minApprovals,
            approverRoleId: step.approverRoleId ?? null,
            approverUserId: step.approverUserId ?? null,
            fallbackRoleId: step.fallbackRoleId ?? null,
            dueInHours: step.dueInHours ?? null,
            condition: step.condition ? (step.condition as Prisma.InputJsonValue) : undefined,
          })),
        },
      },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    await recordAuditLog(
      {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'WORKFLOW_UPDATED',
        resource: 'APPROVAL_WORKFLOW',
        resourceId: updated.id,
        description: `Updated approval workflow "${updated.name}" to version ${updated.version}.`,
      },
      tx,
    );
    return updated;
  });
}

export async function toggleWorkflowActive(input: {
  organizationId: string;
  actorUserId: string;
  workflowId: string;
  isActive: boolean;
}) {
  const workflow = await prisma.approvalWorkflow.findFirst({
    where: { id: input.workflowId, organizationId: input.organizationId },
  });
  if (!workflow) throw new TenantScopeError();
  const updated = await prisma.approvalWorkflow.update({
    where: { id: workflow.id },
    data: { isActive: Boolean(input.isActive) },
  });
  await recordAuditLog({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: input.isActive ? 'WORKFLOW_ENABLED' : 'WORKFLOW_DISABLED',
    resource: 'APPROVAL_WORKFLOW',
    resourceId: workflow.id,
    description: `${input.isActive ? 'Enabled' : 'Disabled'} workflow "${workflow.name}".`,
  });
  return updated;
}

export async function listWorkflows(organizationId: string) {
  return prisma.approvalWorkflow.findMany({
    where: { organizationId },
    include: {
      steps: { orderBy: { stepOrder: 'asc' } },
      _count: { select: { requests: true } },
    },
    orderBy: [{ moduleKey: 'asc' }, { name: 'asc' }],
  });
}

export async function getWorkflow(organizationId: string, id: string) {
  const workflow = await prisma.approvalWorkflow.findFirst({
    where: { id, organizationId },
    include: { steps: { orderBy: { stepOrder: 'asc' } } },
  });
  if (!workflow) throw new TenantScopeError();
  return workflow;
}

export async function listDelegations(organizationId: string) {
  return prisma.approvalDelegation.findMany({
    where: { organizationId },
    include: {
      fromUser: { select: { name: true, email: true, role: { select: { name: true } } } },
      toUser: { select: { name: true, email: true, role: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

export async function endDelegation(input: {
  organizationId: string;
  actorUserId: string;
  delegationId: string;
}) {
  const delegation = await prisma.approvalDelegation.findFirst({
    where: { id: input.delegationId, organizationId: input.organizationId },
  });
  if (!delegation) throw new TenantScopeError();
  return prisma.approvalDelegation.update({
    where: { id: delegation.id },
    data: { isActive: false, endDate: new Date() },
  });
}

export async function listApprovalRequests(input: {
  organizationId: string;
  page?: number;
  pageSize?: number;
  status?: string;
  moduleKey?: string;
  requesterId?: string;
}) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, input.pageSize ?? 20));
  const where: Prisma.ApprovalRequestWhereInput = {
    organizationId: input.organizationId,
    ...(input.status ? { status: input.status } : {}),
    ...(input.moduleKey ? { moduleKey: input.moduleKey } : {}),
    ...(input.requesterId ? { requesterId: input.requesterId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.approvalRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        requester: { select: { name: true, email: true } },
        workflow: { select: { name: true } },
        steps: { orderBy: { stepOrder: 'asc' } },
      },
    }),
    prisma.approvalRequest.count({ where }),
  ]);
  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
