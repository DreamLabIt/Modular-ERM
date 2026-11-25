import { prisma } from '@/core/db/prisma';
import type { CreateCrmCustomerInput, CreateLeadInput } from '@/core/types';

export async function createCustomer(input: CreateCrmCustomerInput) {
  await prisma.customer.create({
    data: {
      organizationId: input.organizationId,
      name: input.name,
      company: input.company,
      email: input.email,
      phone: input.phone,
      status: input.status,
    },
  });
}

export async function createLead(input: CreateLeadInput) {
  await prisma.lead.create({
    data: {
      organizationId: input.organizationId,
      title: input.title,
      contactName: input.contactName,
      email: input.email,
      estimatedValue: input.estimatedValue,
      stage: input.stage,
    },
  });
}

export async function listCustomers(organizationId: string) {
  return prisma.customer.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listLeads(organizationId: string) {
  return prisma.lead.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });
}
