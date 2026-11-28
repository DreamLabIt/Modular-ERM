'use server';

import { revalidatePath } from 'next/cache';
import { requireModuleAccess } from '@/core/auth/module-guard';
import { createEmployee, createLeaveRequest, markAttendance, updateLeaveStatus } from './model';

export async function createEmployeeAction(formData: FormData) {
  const tenant = await requireModuleAccess('hrm', 'hrm.manage');
  const employeeCode = String(formData.get('employeeCode') || '').trim();
  const fullName = String(formData.get('fullName') || '').trim();
  const designation = String(formData.get('designation') || '').trim();
  const department = String(formData.get('department') || '').trim();
  const basicSalary = Number(formData.get('basicSalary') || 0);

  if (!employeeCode || !fullName) return;

  await createEmployee({
    organizationId: tenant.organizationId,
    employeeCode,
    fullName,
    designation,
    department,
    basicSalary,
  });
  revalidatePath('/hrm/employees');
  revalidatePath('/projects');
  revalidatePath('/dashboard');
}

export async function markAttendanceAction(employeeId: string, status: string) {
  const tenant = await requireModuleAccess('hrm', 'hrm.manage');
  const allowedStatuses = new Set(['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY']);
  if (!allowedStatuses.has(status)) return { error: 'Invalid attendance status.' };
  const updated = await markAttendance({ organizationId: tenant.organizationId, employeeId, status });
  if (!updated) return { error: 'Employee not found.' };
  revalidatePath('/hrm/attendance');
  return { success: true };
}

export async function createLeaveRequestAction(formData: FormData) {
  const tenant = await requireModuleAccess('hrm', 'hrm.view');
  const employeeId = String(formData.get('employeeId') || '');
  const leaveType = String(formData.get('leaveType') || 'CASUAL');
  const startDate = new Date(String(formData.get('startDate') || new Date().toISOString()));
  const endDate = new Date(String(formData.get('endDate') || new Date().toISOString()));
  const days = Math.max(1, Number(formData.get('days') || 1));
  const reason = String(formData.get('reason') || '').trim();

  if (!employeeId) return;

  await createLeaveRequest({
    organizationId: tenant.organizationId,
    employeeId,
    leaveType,
    startDate,
    endDate,
    days,
    reason,
    actorUserId: tenant.userId,
  });
  revalidatePath('/hrm/leaves');
}

export async function updateLeaveStatusAction(leaveId: string, status: string) {
  const tenant = await requireModuleAccess('hrm', 'hrm.manage');
  const allowedStatuses = new Set(['PENDING', 'APPROVED', 'REJECTED']);
  if (!allowedStatuses.has(status)) return { error: 'Invalid leave status.' };
  await updateLeaveStatus(leaveId, tenant.organizationId, status);
  revalidatePath('/hrm/leaves');
}
