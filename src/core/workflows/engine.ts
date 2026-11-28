import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { ValidationError, AuthorizationError, ConflictError } from '@/core/errors';
import { createNotification } from '@/core/notifications/service';
import { emailTemplates } from '@/core/notifications/templates';
import { applyApprovalOutcome } from './adapters';
import { evaluateConditions } from './conditions';

type DbClient = Prisma.TransactionClient | PrismaClient;

export interface StartApprovalInput {
  organizationId: string;
  moduleKey: string;
  resourceType: string;
  resourceId: string;
  title: string;
  requesterId: string;
  payload?: Record<string, unknown>;
  workflowId?: string;
}

export interface ApprovalStepView {
  id: string;
  stepOrder: number;
  name: string;
  approvalMode: string;
  minApprovals: number;
  status: string;
  approverRoleId: string | null;
  approverUserId: string | null;
  fallbackRoleId: string | null;
  dueAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export type WorkflowResult<T = undefined> =
  | ({ success: true } & (T extends undefined ? { data?: T } : { data: T }))
  | { success: false; error: string; noWorkflow?: boolean };

export async function findApplicableWorkflow(
  db: DbClient,
  organizationId: string,
  moduleKey: string,
  resourceType: string,
  payload: Record<string, unknown>,
) {
  const workflows = await db.approvalWorkflow.findMany({
    where: { organizationId, moduleKey, resourceType, isActive: true },
    include: { steps: { orderBy: { stepOrder: 'asc' } } },
    orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
  });
  return workflows.find((workflow) => evaluateConditions(workflow.conditions, payload)) ?? null;
}

async function resolveApproverUsers(
  db: DbClient,
  organizationId: string,
  step: { approverUserId: string | null; approverRoleId: string | null; fallbackRoleId: string | null },
) {
  if (step.approverUserId) {
    const user = await db.user.findFirst({
      where: { id: step.approverUserId, organizationId, isActive: true },
      select: { id: true, name: true, email: true, roleId: true },
    });
    if (user) return [user];
  }
  if (step.approverRoleId) {
    const users = await db.user.findMany({
      where: { organizationId, roleId: step.approverRoleId, isActive: true },
      select: { id: true, name: true, email: true, roleId: true },
    });
    if (users.length > 0) return users;
  }
  if (step.fallbackRoleId) {
    return db.user.findMany({
      where: { organizationId, roleId: step.fallbackRoleId, isActive: true },
      select: { id: true, name: true, email: true, roleId: true },
    });
  }
  return [];
}

async function notifyApprovers(
  db: DbClient,
  request: { id: string; organizationId: string; title: string; requesterId: string },
  step: { approverUserId: string | null; approverRoleId: string | null; fallbackRoleId: string | null; name: string },
  requesterName: string,
) {
  const approvers = await resolveApproverUsers(db, request.organizationId, step);
  for (const approver of approvers) {
    await createNotification({
      organizationId: request.organizationId,
      userId: approver.id,
      category: 'APPROVAL',
      type: 'ACTION_REQUIRED',
      title: 'Approval required',
      message: `${requesterName} submitted "${request.title}" for approval at step "${step.name}".`,
      resourceType: 'APPROVAL_REQUEST',
      resourceId: request.id,
      actionUrl: `/approvals/${request.id}`,
      channels: ['IN_APP', 'EMAIL'],
      email: emailTemplates.approvalRequest(request.title, requesterName, 'Your organization', `/approvals/${request.id}`),
      deliverNow: false,
      db,
    });
  }
  return approvers.length;
}

async function notifyRequester(
  db: DbClient,
  request: { organizationId: string; requesterId: string; title: string; id: string },
  outcome: string,
  comment: string | null,
) {
  await createNotification({
    organizationId: request.organizationId,
    userId: request.requesterId,
    category: 'APPROVAL',
    type: outcome === 'APPROVED' ? 'SUCCESS' : 'WARNING',
    title: `Approval ${outcome.toLowerCase()}`,
    message: `Your request "${request.title}" was ${outcome.toLowerCase()}.${comment ? ` Comment: ${comment}` : ''}`,
    resourceType: 'APPROVAL_REQUEST',
    resourceId: request.id,
    actionUrl: `/approvals/${request.id}`,
    channels: ['IN_APP', 'EMAIL'],
    email: emailTemplates.approvalResult(request.title, outcome, comment, 'Your organization', `/approvals/${request.id}`),
    deliverNow: false,
    db,
  });
}

function computeDueAt(dueInHours: number | null, from = new Date()): Date | null {
  return dueInHours && dueInHours > 0
    ? new Date(from.getTime() + dueInHours * 60 * 60 * 1000)
    : null;
}

/**
 * Starts an approval request using the active workflow that matches the module,
 * resource, and structured conditions. Call inside the business transaction.
 */
export async function startApproval(
  input: StartApprovalInput,
  db: DbClient = prisma,
): Promise<WorkflowResult<{ requestId: string; workflowId: string }>> {
  const payload = input.payload ?? {};
  const workflow = input.workflowId
    ? await db.approvalWorkflow.findFirst({
        where: {
          id: input.workflowId,
          organizationId: input.organizationId,
          moduleKey: input.moduleKey,
          resourceType: input.resourceType,
          isActive: true,
        },
        include: { steps: { orderBy: { stepOrder: 'asc' } } },
      })
    : await findApplicableWorkflow(
        db,
        input.organizationId,
        input.moduleKey,
        input.resourceType,
        payload,
      );

  if (!workflow) {
    return { success: false, error: 'No active approval workflow matches this request.', noWorkflow: true };
  }
  if (workflow.steps.length === 0) {
    return { success: false, error: 'The selected workflow has no approval steps.' };
  }

  const requester = await db.user.findFirst({
    where: { id: input.requesterId, organizationId: input.organizationId, isActive: true },
    select: { id: true, name: true },
  });
  if (!requester) return { success: false, error: 'Requester was not found in this organization.' };

  const existing = await db.approvalRequest.findFirst({
    where: {
      organizationId: input.organizationId,
      moduleKey: input.moduleKey,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      status: 'PENDING',
    },
    select: { id: true },
  });
  if (existing) {
    return { success: false, error: 'An approval request is already pending for this record.' };
  }

  const now = new Date();
  const request = await db.approvalRequest.create({
    data: {
      organizationId: input.organizationId,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      moduleKey: input.moduleKey,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      title: input.title,
      requesterId: input.requesterId,
      payload: payload as Prisma.InputJsonValue,
      status: 'PENDING',
      currentStep: workflow.steps[0].stepOrder,
      steps: {
        create: workflow.steps.map((step, index) => ({
          stepOrder: step.stepOrder,
          name: step.name,
          approvalMode: step.approvalMode,
          minApprovals: step.minApprovals,
          approverRoleId: step.approverRoleId,
          approverUserId: step.approverUserId,
          fallbackRoleId: step.fallbackRoleId,
          dueInHours: step.dueInHours,
          status: index === 0 ? 'ACTIVE' : 'PENDING',
          startedAt: index === 0 ? now : null,
          dueAt: index === 0 ? computeDueAt(step.dueInHours, now) : null,
        })),
      },
    },
    include: { steps: { orderBy: { stepOrder: 'asc' } } },
  });

  await db.approvalAction.create({
    data: {
      organizationId: input.organizationId,
      requestId: request.id,
      actorUserId: input.requesterId,
      action: 'SUBMITTED',
      comment: 'Request submitted for approval.',
      attempt: 1,
    },
  });

  const firstStep = request.steps[0];
  await notifyApprovers(db, request, firstStep, requester.name);

  return { success: true, data: { requestId: request.id, workflowId: workflow.id } };
}

async function resolveActorAssignment(
  db: DbClient,
  request: { organizationId: string; moduleKey: string; id: string },
  step: { approverUserId: string | null; approverRoleId: string | null; id: string },
  actorUserId: string,
) {
  const actor = await db.user.findFirst({
    where: { id: actorUserId, organizationId: request.organizationId, isActive: true },
    select: { id: true, roleId: true, name: true },
  });
  if (!actor) throw new AuthorizationError('Your account is not active in this organization.');

  const directAssignment =
    step.approverUserId === actor.id ||
    (step.approverRoleId !== null && step.approverRoleId === actor.roleId);

  if (directAssignment) {
    return { actor, delegatedFromUserId: null as string | null };
  }

  const now = new Date();
  const delegations = await db.approvalDelegation.findMany({
    where: {
      organizationId: request.organizationId,
      toUserId: actor.id,
      isActive: true,
      startDate: { lte: now },
      endDate: { gte: now },
      OR: [{ moduleKey: null }, { moduleKey: request.moduleKey }],
    },
    include: { fromUser: { select: { id: true, roleId: true, isActive: true } } },
  });

  for (const delegation of delegations) {
    if (!delegation.fromUser.isActive) continue;
    if (
      delegation.fromUser.id === step.approverUserId ||
      (step.approverRoleId !== null && delegation.fromUser.roleId === step.approverRoleId)
    ) {
      return { actor, delegatedFromUserId: delegation.fromUser.id };
    }
  }

  throw new AuthorizationError('You are not assigned as an approver for the current step.');
}

export interface ApprovalDecisionInput {
  organizationId: string;
  requestId: string;
  actorUserId: string;
  comment?: string | null;
}

export async function approveRequest(
  input: ApprovalDecisionInput,
): Promise<WorkflowResult<{ status: string; currentStep: number }>> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const request = await tx.approvalRequest.findFirst({
          where: { id: input.requestId, organizationId: input.organizationId },
          include: {
            steps: { orderBy: { stepOrder: 'asc' } },
            requester: { select: { id: true, name: true } },
          },
        });
        if (!request) return { success: false, error: 'Approval request not found.' } as const;
        if (request.status !== 'PENDING') {
          return { success: false, error: `This request is already ${request.status.toLowerCase()}.` } as const;
        }

        const step = request.steps.find(
          (candidate) => candidate.stepOrder === request.currentStep && candidate.status === 'ACTIVE',
        );
        if (!step) return { success: false, error: 'The current approval step is not active.' } as const;

        const { actor, delegatedFromUserId } = await resolveActorAssignment(
          tx,
          request,
          step,
          input.actorUserId,
        );

        const duplicate = await tx.approvalAction.findFirst({
          where: {
            requestId: request.id,
            stepId: step.id,
            actorUserId: actor.id,
            action: 'APPROVED',
            attempt: request.attempt,
          },
          select: { id: true },
        });
        if (duplicate) {
          return { success: false, error: 'You have already approved this step.' } as const;
        }

        await tx.approvalAction.create({
          data: {
            organizationId: request.organizationId,
            requestId: request.id,
            stepId: step.id,
            actorUserId: actor.id,
            action: 'APPROVED',
            comment: input.comment?.trim() || null,
            attempt: request.attempt,
            delegatedFromUserId,
          },
        });

        const approvalCount = await tx.approvalAction.count({
          where: {
            requestId: request.id,
            stepId: step.id,
            action: 'APPROVED',
            attempt: request.attempt,
          },
        });

        if (approvalCount < step.minApprovals) {
          return {
            success: true,
            data: { status: request.status, currentStep: request.currentStep },
          } as const;
        }

        const now = new Date();
        await tx.approvalRequestStep.update({
          where: { id: step.id },
          data: { status: 'APPROVED', completedAt: now },
        });

        const nextStep = request.steps.find(
          (candidate) => candidate.stepOrder > step.stepOrder && candidate.status === 'PENDING',
        );

        if (nextStep) {
          const updated = await tx.approvalRequest.updateMany({
            where: { id: request.id, organizationId: request.organizationId, status: 'PENDING', currentStep: request.currentStep },
            data: { currentStep: nextStep.stepOrder },
          });
          if (updated.count !== 1) {
            throw new ConflictError('The approval request changed concurrently. Reload and retry.');
          }
          await tx.approvalRequestStep.update({
            where: { id: nextStep.id },
            data: { status: 'ACTIVE', startedAt: now, dueAt: computeDueAt(nextStep.dueInHours, now) },
          });
          await notifyApprovers(tx, request, nextStep, request.requester.name);
          return {
            success: true,
            data: { status: 'PENDING', currentStep: nextStep.stepOrder },
          } as const;
        }

        await tx.approvalRequest.update({
          where: { id: request.id },
          data: { status: 'APPROVED', completedAt: now },
        });
        await tx.approvalAction.create({
          data: {
            organizationId: request.organizationId,
            requestId: request.id,
            actorUserId: actor.id,
            action: 'COMPLETED',
            comment: 'All approval levels completed.',
            attempt: request.attempt,
          },
        });
        await applyApprovalOutcome(
          tx,
          {
            organizationId: request.organizationId,
            resourceType: request.resourceType,
            resourceId: request.resourceId,
            title: request.title,
            moduleKey: request.moduleKey,
            payload: request.payload,
          },
          'APPROVED',
          actor.id,
          input.comment?.trim() || null,
        );
        await notifyRequester(tx, request, 'APPROVED', input.comment?.trim() || null);

        return {
          success: true,
          data: { status: 'APPROVED', currentStep: request.currentStep },
        } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof ConflictError || error instanceof AuthorizationError || error instanceof ValidationError) {
      return { success: false, error: error.message };
    }
    throw error;
  }
}

export async function rejectRequest(
  input: ApprovalDecisionInput,
): Promise<WorkflowResult<{ status: string }>> {
  const comment = input.comment?.trim();
  if (!comment) return { success: false, error: 'A rejection reason is required.' };

  try {
    return await prisma.$transaction(
      async (tx) => {
        const request = await tx.approvalRequest.findFirst({
          where: { id: input.requestId, organizationId: input.organizationId },
          include: {
            steps: { orderBy: { stepOrder: 'asc' } },
            requester: { select: { id: true, name: true } },
          },
        });
        if (!request) return { success: false, error: 'Approval request not found.' } as const;
        if (request.status !== 'PENDING') {
          return { success: false, error: `This request is already ${request.status.toLowerCase()}.` } as const;
        }
        const step = request.steps.find(
          (candidate) => candidate.stepOrder === request.currentStep && candidate.status === 'ACTIVE',
        );
        if (!step) return { success: false, error: 'The current approval step is not active.' } as const;

        const { actor, delegatedFromUserId } = await resolveActorAssignment(
          tx,
          request,
          step,
          input.actorUserId,
        );

        const duplicate = await tx.approvalAction.findFirst({
          where: {
            requestId: request.id,
            stepId: step.id,
            actorUserId: actor.id,
            action: 'REJECTED',
            attempt: request.attempt,
          },
          select: { id: true },
        });
        if (duplicate) {
          return { success: false, error: 'You have already rejected this step.' } as const;
        }

        const now = new Date();
        await tx.approvalAction.create({
          data: {
            organizationId: request.organizationId,
            requestId: request.id,
            stepId: step.id,
            actorUserId: actor.id,
            action: 'REJECTED',
            comment,
            attempt: request.attempt,
            delegatedFromUserId,
          },
        });
        await tx.approvalRequestStep.update({
          where: { id: step.id },
          data: { status: 'REJECTED', completedAt: now },
        });
        await tx.approvalRequest.update({
          where: { id: request.id },
          data: { status: 'REJECTED', completedAt: now },
        });
        await applyApprovalOutcome(
          tx,
          {
            organizationId: request.organizationId,
            resourceType: request.resourceType,
            resourceId: request.resourceId,
            title: request.title,
            moduleKey: request.moduleKey,
            payload: request.payload,
          },
          'REJECTED',
          actor.id,
          comment,
        );
        await notifyRequester(tx, request, 'REJECTED', comment);

        return { success: true, data: { status: 'REJECTED' } } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof ConflictError || error instanceof AuthorizationError || error instanceof ValidationError) {
      return { success: false, error: error.message };
    }
    throw error;
  }
}

export async function cancelRequest(input: {
  organizationId: string;
  requestId: string;
  actorUserId: string;
  reason?: string;
  canManageAny?: boolean;
}): Promise<WorkflowResult<{ status: string }>> {
  const request = await prisma.approvalRequest.findFirst({
    where: { id: input.requestId, organizationId: input.organizationId },
  });
  if (!request) return { success: false, error: 'Approval request not found.' };
  if (request.status !== 'PENDING') return { success: false, error: 'Only pending requests can be cancelled.' };
  if (!input.canManageAny && request.requesterId !== input.actorUserId) {
    return { success: false, error: 'Only the requester or a workflow manager can cancel this request.' };
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.approvalRequest.update({
      where: { id: request.id },
      data: { status: 'CANCELLED', cancelledAt: now, completedAt: now },
    });
    await tx.approvalRequestStep.updateMany({
      where: { requestId: request.id, status: { in: ['PENDING', 'ACTIVE'] } },
      data: { status: 'SKIPPED', completedAt: now },
    });
    await tx.approvalAction.create({
      data: {
        organizationId: request.organizationId,
        requestId: request.id,
        actorUserId: input.actorUserId,
        action: 'CANCELLED',
        comment: input.reason?.trim() || 'Request cancelled.',
        attempt: request.attempt,
      },
    });
  });
  return { success: true, data: { status: 'CANCELLED' } };
}

export async function resubmitRequest(input: {
  organizationId: string;
  requestId: string;
  actorUserId: string;
}): Promise<WorkflowResult<{ status: string }>> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const request = await tx.approvalRequest.findFirst({
          where: { id: input.requestId, organizationId: input.organizationId },
          include: { steps: { orderBy: { stepOrder: 'asc' } }, requester: { select: { name: true } } },
        });
        if (!request) return { success: false, error: 'Approval request not found.' } as const;
        if (request.requesterId !== input.actorUserId) {
          return { success: false, error: 'Only the requester can resubmit this request.' } as const;
        }
        if (!['REJECTED', 'CANCELLED'].includes(request.status)) {
          return { success: false, error: 'Only rejected or cancelled requests can be resubmitted.' } as const;
        }
        if (request.steps.length === 0) {
          return { success: false, error: 'This request has no approval steps.' } as const;
        }

        const now = new Date();
        const firstStep = request.steps[0];
        const updated = await tx.approvalRequest.updateMany({
          where: { id: request.id, organizationId: request.organizationId, status: request.status },
          data: {
            status: 'PENDING',
            currentStep: firstStep.stepOrder,
            attempt: { increment: 1 },
            completedAt: null,
            cancelledAt: null,
          },
        });
        if (updated.count !== 1) {
          throw new ConflictError('The approval request changed concurrently. Reload and retry.');
        }
        await tx.approvalRequestStep.updateMany({
          where: { requestId: request.id },
          data: { status: 'PENDING', startedAt: null, completedAt: null, dueAt: null },
        });
        await tx.approvalRequestStep.update({
          where: { id: firstStep.id },
          data: { status: 'ACTIVE', startedAt: now, dueAt: computeDueAt(firstStep.dueInHours, now) },
        });
        await tx.approvalAction.create({
          data: {
            organizationId: request.organizationId,
            requestId: request.id,
            actorUserId: input.actorUserId,
            action: 'RESUBMITTED',
            comment: 'Request resubmitted for approval.',
            attempt: request.attempt + 1,
          },
        });
        await notifyApprovers(tx, request, firstStep, request.requester.name);
        return { success: true, data: { status: 'PENDING' } } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof ConflictError) return { success: false, error: error.message };
    throw error;
  }
}

export async function createApprovalDelegation(input: {
  organizationId: string;
  fromUserId: string;
  toUserId: string;
  moduleKey?: string | null;
  startDate: Date;
  endDate: Date;
  reason: string;
  createdById: string;
}): Promise<WorkflowResult<{ id: string }>> {
  const reason = input.reason.trim();
  if (!reason) return { success: false, error: 'A delegation reason is required.' };
  if (input.fromUserId === input.toUserId) {
    return { success: false, error: 'You cannot delegate to yourself.' };
  }
  if (input.endDate <= input.startDate) {
    return { success: false, error: 'Delegation end date must be after the start date.' };
  }
  if (input.endDate <= new Date()) {
    return { success: false, error: 'Delegation end date must be in the future.' };
  }

  const [fromUser, toUser] = await Promise.all([
    prisma.user.findFirst({ where: { id: input.fromUserId, organizationId: input.organizationId, isActive: true } }),
    prisma.user.findFirst({ where: { id: input.toUserId, organizationId: input.organizationId, isActive: true } }),
  ]);
  if (!fromUser || !toUser) {
    return { success: false, error: 'Both users must be active members of this organization.' };
  }

  const delegation = await prisma.approvalDelegation.create({
    data: {
      organizationId: input.organizationId,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      moduleKey: input.moduleKey ?? null,
      startDate: input.startDate,
      endDate: input.endDate,
      reason,
      createdById: input.createdById,
    },
  });
  return { success: true, data: { id: delegation.id } };
}

export async function listPendingApprovalsForUser(
  organizationId: string,
  userId: string,
  roleId: string,
) {
  const now = new Date();
  const delegations = await prisma.approvalDelegation.findMany({
    where: {
      organizationId,
      toUserId: userId,
      isActive: true,
      startDate: { lte: now },
      endDate: { gte: now },
    },
    include: { fromUser: { select: { id: true, roleId: true } } },
  });
  const delegatedFromUserIds = delegations.map((delegation) => delegation.fromUser.id);
  const delegatedRoleIds = delegations.map((delegation) => delegation.fromUser.roleId);

  const requests = await prisma.approvalRequest.findMany({
    where: {
      organizationId,
      status: 'PENDING',
      steps: { some: { status: 'ACTIVE' } },
    },
    include: {
      requester: { select: { name: true } },
      workflow: { select: { name: true } },
      steps: { orderBy: { stepOrder: 'asc' } },
    },
    orderBy: { submittedAt: 'desc' },
    take: 200,
  });

  return requests.filter((request) => {
    const step = request.steps.find(
      (candidate) => candidate.stepOrder === request.currentStep && candidate.status === 'ACTIVE',
    );
    if (!step) return false;
    return (
      step.approverUserId === userId ||
      step.approverRoleId === roleId ||
      (step.approverUserId !== null && delegatedFromUserIds.includes(step.approverUserId)) ||
      (step.approverRoleId !== null && delegatedRoleIds.includes(step.approverRoleId))
    );
  });
}

export async function getApprovalRequestDetails(organizationId: string, requestId: string) {
  return prisma.approvalRequest.findFirst({
    where: { id: requestId, organizationId },
    include: {
      requester: { select: { id: true, name: true, email: true } },
      workflow: { select: { id: true, name: true, version: true, moduleKey: true, resourceType: true } },
      steps: { orderBy: { stepOrder: 'asc' } },
      actions: {
        orderBy: { createdAt: 'asc' },
        include: { actor: { select: { name: true, email: true } } },
      },
    },
  });
}
