'use server';

import { guardedAction } from '@/core/auth/action';
import { ValidationError } from '@/core/errors';
import {
  createWorkflow,
  updateWorkflow,
  toggleWorkflowActive,
  endDelegation,
  type WorkflowInput,
} from '@/core/workflows/management';
import {
  approveRequest,
  rejectRequest,
  cancelRequest,
  resubmitRequest,
  createApprovalDelegation,
} from '@/core/workflows/engine';

function json(formData: FormData, key: string): unknown {
  const raw = String(formData.get(key) || '').trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError('The submitted JSON is invalid.');
  }
}

function bool(value: FormDataEntryValue | null): boolean {
  return value === 'on' || value === 'true' || value === '1';
}

function parseWorkflow(formData: FormData): WorkflowInput {
  return {
    name: String(formData.get('name') || ''),
    description: String(formData.get('description') || ''),
    moduleKey: String(formData.get('moduleKey') || ''),
    resourceType: String(formData.get('resourceType') || ''),
    conditions: json(formData, 'conditions'),
    isActive: formData.has('isActive') ? bool(formData.get('isActive')) : true,
    steps: (json(formData, 'steps') as WorkflowInput['steps']) ?? [],
  };
}

export async function saveWorkflowAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') || '');
  await guardedAction({
    permission: 'workflow.manage',
    revalidate: ['/workflows', '/approvals'],
    redirectTo: '/workflows',
    successMessage: 'Workflow saved.',
  }, async (tenant) => {
    const workflow = parseWorkflow(formData);
    if (id) {
      await updateWorkflow({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        workflowId: id,
        workflow,
      });
    } else {
      await createWorkflow({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        workflow,
      });
    }
  });
}

export async function toggleWorkflowAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'workflow.manage',
    revalidate: '/workflows',
    redirectTo: '/workflows',
    successMessage: 'Workflow status updated.',
  }, async (tenant) => {
    await toggleWorkflowActive({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      workflowId: String(formData.get('id') || ''),
      isActive: bool(formData.get('isActive')),
    });
  });
}

export async function createDelegationAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'workflow.delegate',
    revalidate: '/workflows',
    redirectTo: '/workflows',
    successMessage: 'Approval delegation created.',
  }, async (tenant) => {
    const result = await createApprovalDelegation({
      organizationId: tenant.organizationId,
      fromUserId: String(formData.get('fromUserId') || ''),
      toUserId: String(formData.get('toUserId') || ''),
      moduleKey: String(formData.get('moduleKey') || '') || null,
      startDate: new Date(String(formData.get('startDate') || '')),
      endDate: new Date(String(formData.get('endDate') || '')),
      reason: String(formData.get('reason') || ''),
      createdById: tenant.userId,
    });
    if (!result.success) throw new ValidationError(result.error);
  });
}

export async function endDelegationAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'workflow.delegate',
    revalidate: '/workflows',
    redirectTo: '/workflows',
    successMessage: 'Delegation ended.',
  }, async (tenant) => {
    await endDelegation({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      delegationId: String(formData.get('id') || ''),
    });
  });
}

export async function approveAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'workflow.approve',
    revalidate: ['/approvals', '/dashboard'],
    redirectTo: '/approvals',
    successMessage: 'Request approved.',
  }, async (tenant) => {
    const result = await approveRequest({
      organizationId: tenant.organizationId,
      requestId: String(formData.get('requestId') || ''),
      actorUserId: tenant.userId,
      comment: String(formData.get('comment') || '') || null,
    });
    if (!result.success) throw new ValidationError(result.error);
  });
}

export async function rejectAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'workflow.approve',
    revalidate: ['/approvals', '/dashboard'],
    redirectTo: '/approvals',
    successMessage: 'Request rejected.',
  }, async (tenant) => {
    const result = await rejectRequest({
      organizationId: tenant.organizationId,
      requestId: String(formData.get('requestId') || ''),
      actorUserId: tenant.userId,
      comment: String(formData.get('comment') || ''),
    });
    if (!result.success) throw new ValidationError(result.error);
  });
}

export async function cancelApprovalAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'workflow.view',
    revalidate: ['/approvals', '/dashboard'],
    redirectTo: '/approvals',
    successMessage: 'Request cancelled.',
  }, async (tenant) => {
    const result = await cancelRequest({
      organizationId: tenant.organizationId,
      requestId: String(formData.get('requestId') || ''),
      actorUserId: tenant.userId,
      reason: String(formData.get('reason') || '') || undefined,
    });
    if (!result.success) throw new ValidationError(result.error);
  });
}

export async function resubmitApprovalAction(formData: FormData): Promise<void> {
  await guardedAction({
    permission: 'workflow.view',
    revalidate: ['/approvals', '/dashboard'],
    redirectTo: '/approvals',
    successMessage: 'Request resubmitted.',
  }, async (tenant) => {
    const result = await resubmitRequest({
      organizationId: tenant.organizationId,
      requestId: String(formData.get('requestId') || ''),
      actorUserId: tenant.userId,
    });
    if (!result.success) throw new ValidationError(result.error);
  });
}
