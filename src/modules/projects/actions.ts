'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireModuleAccess } from '@/core/auth/module-guard';
import {
  PROJECT_TASK_STATUSES,
  type UpdateTaskStatusResult,
} from '@/core/types';
import { createProject, createTask, updateProjectTaskStatus } from './model';

const taskStatusSchema = z.enum(PROJECT_TASK_STATUSES);

export async function createProjectAction(formData: FormData) {
  const tenant = await requireModuleAccess('projects', 'projects.manage');
  const name = String(formData.get('name') || '').trim();
  const customerId = String(formData.get('customerId') || '') || null;
  const deadlineRaw = String(formData.get('deadline') || '');
  const budget = Number(formData.get('budget') || 0);

  if (!name) return;

  const created = await createProject({
    organizationId: tenant.organizationId,
    customerId,
    name,
    deadline: deadlineRaw ? new Date(deadlineRaw) : null,
    budget,
  });
  if (!created) return;

  revalidatePath('/projects');
  revalidatePath('/dashboard');
}

export async function createTaskAction(formData: FormData) {
  const tenant = await requireModuleAccess('projects', 'projects.manage');
  const projectId = String(formData.get('projectId') || '');
  const title = String(formData.get('title') || '').trim();
  const assigneeName = String(formData.get('assigneeName') || '').trim();
  const assigneeEmployeeId = String(formData.get('assigneeEmployeeId') || '') || null;
  const dueDateRaw = String(formData.get('dueDate') || '');
  const priority = String(formData.get('priority') || 'MEDIUM');

  if (!projectId || !title) return;

  const created = await createTask({
    organizationId: tenant.organizationId,
    projectId,
    title,
    assigneeName,
    assigneeEmployeeId,
    dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
    priority,
  });
  if (!created) return;

  revalidatePath('/projects');
  revalidatePath('/dashboard');
}

export async function updateTaskStatusAction(
  taskId: string,
  status: string,
): Promise<UpdateTaskStatusResult> {
  const tenant = await requireModuleAccess('projects', 'projects.manage');
  const parsedStatus = taskStatusSchema.safeParse(status);
  if (!parsedStatus.success || !taskId.trim()) {
    return { success: false, error: 'Choose a valid task status.' };
  }

  const updated = await updateProjectTaskStatus(
    taskId,
    tenant.organizationId,
    parsedStatus.data,
  );
  if (!updated) {
    return { success: false, error: 'This task could not be found.' };
  }

  revalidatePath('/projects');
  revalidatePath('/dashboard');
  return { success: true };
}
