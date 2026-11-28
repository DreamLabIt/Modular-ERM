import { prisma } from '@/core/db/prisma';
import { assertUsageLimit } from '@/core/billing/usage';
import type {
  CreateProjectInput,
  CreateProjectTaskInput,
  ProjectTaskStatus,
} from '@/core/types';

export async function createProject(input: CreateProjectInput) {
  await assertUsageLimit(input.organizationId, 'PROJECTS');
  if (input.customerId) {
    const customer = await prisma.customer.findFirst({
      where: {
        id: input.customerId,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });
    if (!customer) return false;
  }

  await prisma.project.create({
    data: {
      organizationId: input.organizationId,
      customerId: input.customerId,
      name: input.name,
      deadline: input.deadline,
      budget: input.budget,
      status: 'IN_PROGRESS',
    },
  });
  return true;
}

export async function createTask(input: CreateProjectTaskInput) {
  return prisma.$transaction(async (transaction) => {
    const project = await transaction.project.findFirst({
      where: { id: input.projectId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!project) return false;

    const assignee = input.assigneeEmployeeId
      ? await transaction.employee.findFirst({
          where: {
            id: input.assigneeEmployeeId,
            organizationId: input.organizationId,
            status: 'ACTIVE',
          },
          select: { id: true, fullName: true },
        })
      : null;
    if (input.assigneeEmployeeId && !assignee) return false;

    await transaction.projectTask.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        title: input.title,
        assigneeEmployeeId: assignee?.id ?? null,
        assigneeName: assignee?.fullName ?? input.assigneeName,
        dueDate: input.dueDate,
        priority: input.priority,
      },
    });
    return true;
  });
}

export async function updateProjectTaskStatus(
  taskId: string,
  organizationId: string,
  status: ProjectTaskStatus,
) {
  const result = await prisma.projectTask.updateMany({
    where: { id: taskId, organizationId },
    data: { status },
  });
  return result.count > 0;
}

export async function listProjects(organizationId: string) {
  return prisma.project.findMany({
    where: { organizationId },
    include: {
      customer: true,
      tasks: {
        include: { assignee: { select: { fullName: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listCustomers(organizationId: string) {
  return prisma.customer.findMany({ where: { organizationId } });
}

export async function listAssignableEmployees(organizationId: string) {
  return prisma.employee.findMany({
    where: { organizationId, status: 'ACTIVE' },
    select: { id: true, fullName: true },
    orderBy: { fullName: 'asc' },
  });
}
