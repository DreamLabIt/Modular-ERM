import { prisma } from '@/core/db/prisma';
import type { CreateEmployeeInput, CreateLeaveRequestInput, MarkAttendanceInput } from '@/core/types';

export async function createEmployee(input: CreateEmployeeInput) {
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
    select: { id: true },
  });
  if (!employee) return false;

  await prisma.leaveRequest.create({
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
  return true;
}

export async function updateLeaveStatus(leaveId: string, organizationId: string, status: string) {
  await prisma.leaveRequest.updateMany({
    where: { id: leaveId, organizationId },
    data: { status },
  });
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
