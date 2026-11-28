import { prisma } from '@/core/db/prisma';
import type { CreateEmployeeInput, CreateLeaveRequestInput, MarkAttendanceInput } from '@/core/types';
import { startApproval } from '@/core/workflows/engine';
import { createNotification } from '@/core/notifications/service';
import { assertUsageLimit } from '@/core/billing/usage';

export async function createEmployee(input: CreateEmployeeInput) {
  await assertUsageLimit(input.organizationId, 'EMPLOYEES');
  await prisma.employee.create({
    data: {
      organizationId: input.organizationId,
      employeeCode: input.employeeCode,
      fullName: input.fullName,
      designation: input.designation,
      department: input.department,
      joiningDate: new Date(),
      basicSalary: input.basicSalary,
    },
  });
}

export async function markAttendance(input: MarkAttendanceInput) {
  const employee = await prisma.employee.findFirst({
    where: { id: input.employeeId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!employee) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await prisma.attendance.upsert({
    where: { employeeId_date: { employeeId: input.employeeId, date: today } },
    update: { status: input.status, checkIn: new Date() },
    create: {
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      date: today,
      status: input.status,
      checkIn: new Date(),
    },
  });
  return true;
}

export async function createLeaveRequest(input: CreateLeaveRequestInput) {
  const employee = await prisma.employee.findFirst({
    where: { id: input.employeeId, organizationId: input.organizationId },
    select: { id: true, fullName: true, userId: true },
  });
  if (!employee) return false;

  const requesterId = employee.userId ?? input.actorUserId;
  return prisma.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.create({
      data: {
        organizationId: input.organizationId,
        employeeId: input.employeeId,
        leaveType: input.leaveType,
        startDate: input.startDate,
        endDate: input.endDate,
        days: input.days,
        reason: input.reason,
      },
    });

    if (requesterId) {
      const workflow = await startApproval(
        {
          organizationId: input.organizationId,
          moduleKey: 'hrm',
          resourceType: 'LEAVE_REQUEST',
          resourceId: leave.id,
          title: `${input.leaveType} leave request — ${employee.fullName}`,
          requesterId,
          payload: {
            leaveType: input.leaveType,
            days: input.days,
            startDate: input.startDate.toISOString(),
            endDate: input.endDate.toISOString(),
          },
        },
        tx,
      );
      if (workflow.success && workflow.data) {
        await tx.leaveRequest.update({
          where: { id: leave.id },
          data: { approvalLevel: 1 },
        });
      }
    }

    await createNotification({
      organizationId: input.organizationId,
      userId: requesterId ?? null,
      category: 'HRM',
      type: 'INFO',
      title: 'Leave request submitted',
      message: `Your ${input.leaveType} leave request for ${input.days} day(s) was submitted.`,
      resourceType: 'LEAVE_REQUEST',
      resourceId: leave.id,
      actionUrl: '/hrm/leaves',
      channels: ['IN_APP', 'EMAIL'],
      db: tx,
      deliverNow: false,
    });
    return true;
  });
}

export async function updateLeaveStatus(leaveId: string, organizationId: string, status: string) {
  const leave = await prisma.leaveRequest.findFirst({
    where: { id: leaveId, organizationId },
    include: { employee: { select: { userId: true, fullName: true } } },
  });
  if (!leave) return false;

  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({ where: { id: leave.id }, data: { status } });
    if (status === 'APPROVED' || status === 'REJECTED') {
      await tx.leaveRequest.update({
        where: { id: leave.id },
        data: {
          approvedAt: new Date(),
          rejectionReason: status === 'REJECTED' ? 'Rejected by approver.' : null,
        },
      });
      if (leave.employee.userId) {
        await createNotification({
          organizationId,
          userId: leave.employee.userId,
          category: 'HRM',
          type: status === 'APPROVED' ? 'SUCCESS' : 'WARNING',
          title: `Leave request ${status.toLowerCase()}`,
          message: `The leave request for ${leave.employee.fullName} was ${status.toLowerCase()}.`,
          resourceType: 'LEAVE_REQUEST',
          resourceId: leave.id,
          actionUrl: '/hrm/leaves',
          channels: ['IN_APP', 'EMAIL'],
          db: tx,
          deliverNow: false,
        });
      }
    }
  });
  return true;
}

export async function listEmployees(organizationId: string) {
  return prisma.employee.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listAttendanceEmployees(organizationId: string, date: Date) {
  return prisma.employee.findMany({
    where: { organizationId, status: 'ACTIVE' },
    include: { attendances: { where: { date } } },
  });
}

export async function listActiveEmployees(organizationId: string) {
  return prisma.employee.findMany({
    where: { organizationId, status: 'ACTIVE' },
  });
}

export async function listLeaveRequests(organizationId: string) {
  return prisma.leaveRequest.findMany({
    where: { organizationId },
    include: { employee: true },
    orderBy: { createdAt: 'desc' },
  });
}
