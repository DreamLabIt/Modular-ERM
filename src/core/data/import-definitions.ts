import type { Prisma } from '@prisma/client';
import { Prisma as PrismaNamespace } from '@prisma/client';
import type { Permission } from '@/core/types';

export interface ImportColumn {
  key: string;
  label: string;
  required?: boolean;
  aliases?: string[];
  description?: string;
}

export interface ImportRowResult {
  ok: boolean;
  errors: string[];
  action?: 'CREATE' | 'SKIP_DUPLICATE';
  recordId?: string;
}

export interface ImportDefinition {
  resourceType: string;
  label: string;
  moduleKey: string;
  permissions: Permission[];
  columns: ImportColumn[];
  createRow: (
    tx: Prisma.TransactionClient,
    organizationId: string,
    row: Record<string, string>,
  ) => Promise<ImportRowResult>;
}

function value(row: Record<string, string>, key: string): string {
  return (row[key] ?? '').trim();
}

function required(row: Record<string, string>, key: string): string | null {
  const found = value(row, key);
  return found.length > 0 ? found : null;
}

function decimalValue(raw: string): number | null {
  if (!raw) return null;
  const normalized = raw.replace(/,/g, '');
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function intValue(raw: string): number | null {
  if (!raw) return null;
  const numeric = Number(raw);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

function dateValue(raw: string): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const IMPORT_DEFINITIONS: Record<string, ImportDefinition> = {
  employees: {
    resourceType: 'employees',
    label: 'Employees',
    moduleKey: 'hrm',
    permissions: ['data.import', 'hrm.manage'],
    columns: [
      { key: 'employee_code', label: 'Employee Code', required: true, aliases: ['code'] },
      { key: 'full_name', label: 'Full Name', required: true, aliases: ['name'] },
      { key: 'designation', label: 'Designation', required: true },
      { key: 'department', label: 'Department', required: true },
      { key: 'basic_salary', label: 'Basic Salary', required: true },
      { key: 'joining_date', label: 'Joining Date', required: true },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'employment_type', label: 'Employment Type' },
      { key: 'status', label: 'Status' },
    ],
    async createRow(tx, organizationId, row) {
      const errors: string[] = [];
      const employeeCode = required(row, 'employee_code');
      const fullName = required(row, 'full_name');
      const designation = required(row, 'designation');
      const department = required(row, 'department');
      const salary = decimalValue(value(row, 'basic_salary'));
      const joiningDate = dateValue(value(row, 'joining_date'));
      const email = value(row, 'email');
      if (!employeeCode) errors.push('employee_code is required.');
      if (!fullName) errors.push('full_name is required.');
      if (!designation) errors.push('designation is required.');
      if (!department) errors.push('department is required.');
      if (salary === null) errors.push('basic_salary must be a non-negative number.');
      if (!joiningDate) errors.push('joining_date must be a valid date.');
      if (email && !EMAIL_PATTERN.test(email)) errors.push('email is invalid.');
      if (errors.length > 0) return { ok: false, errors };

      const existing = await tx.employee.findFirst({
        where: { organizationId, employeeCode: employeeCode as string },
        select: { id: true },
      });
      if (existing) return { ok: true, errors: [], action: 'SKIP_DUPLICATE', recordId: existing.id };

      const employee = await tx.employee.create({
        data: {
          organizationId,
          employeeCode: employeeCode as string,
          fullName: fullName as string,
          designation: designation as string,
          department: department as string,
          basicSalary: new PrismaNamespace.Decimal(salary as number),
          joiningDate: joiningDate as Date,
          email: email || null,
          phone: value(row, 'phone') || null,
          employmentType: value(row, 'employment_type') || 'FULL_TIME',
          status: value(row, 'status') || 'ACTIVE',
        },
        select: { id: true },
      });
      return { ok: true, errors: [], action: 'CREATE', recordId: employee.id };
    },
  },

  customers: {
    resourceType: 'customers',
    label: 'Customers',
    moduleKey: 'crm',
    permissions: ['data.import', 'crm.manage'],
    columns: [
      { key: 'name', label: 'Customer Name', required: true },
      { key: 'company', label: 'Company' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'address', label: 'Address' },
      { key: 'status', label: 'Status' },
    ],
    async createRow(tx, organizationId, row) {
      const name = required(row, 'name');
      const email = value(row, 'email');
      if (!name) return { ok: false, errors: ['name is required.'] };
      if (email && !EMAIL_PATTERN.test(email)) return { ok: false, errors: ['email is invalid.'] };
      const existing = await tx.customer.findFirst({
        where: { organizationId, name, archivedAt: null },
        select: { id: true },
      });
      if (existing) return { ok: true, errors: [], action: 'SKIP_DUPLICATE', recordId: existing.id };
      const customer = await tx.customer.create({
        data: {
          organizationId,
          name,
          company: value(row, 'company') || null,
          email: email || null,
          phone: value(row, 'phone') || null,
          address: value(row, 'address') || null,
          status: value(row, 'status') || 'ACTIVE',
        },
        select: { id: true },
      });
      return { ok: true, errors: [], action: 'CREATE', recordId: customer.id };
    },
  },

  suppliers: {
    resourceType: 'suppliers',
    label: 'Suppliers',
    moduleKey: 'sales_purchase',
    permissions: ['data.import', 'sales_purchase.manage'],
    columns: [
      { key: 'name', label: 'Supplier Name', required: true },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'address', label: 'Address' },
    ],
    async createRow(tx, organizationId, row) {
      const name = required(row, 'name');
      const email = value(row, 'email');
      if (!name) return { ok: false, errors: ['name is required.'] };
      if (email && !EMAIL_PATTERN.test(email)) return { ok: false, errors: ['email is invalid.'] };
      const existing = await tx.supplier.findFirst({
        where: { organizationId, OR: [{ name }, ...(email ? [{ email }] : [])] },
        select: { id: true },
      });
      if (existing) return { ok: true, errors: [], action: 'SKIP_DUPLICATE', recordId: existing.id };
      const supplier = await tx.supplier.create({
        data: {
          organizationId,
          name,
          email: email || null,
          phone: value(row, 'phone') || null,
          address: value(row, 'address') || null,
        },
        select: { id: true },
      });
      return { ok: true, errors: [], action: 'CREATE', recordId: supplier.id };
    },
  },

  products: {
    resourceType: 'products',
    label: 'Products',
    moduleKey: 'inventory',
    permissions: ['data.import', 'inventory.manage'],
    columns: [
      { key: 'sku', label: 'SKU', required: true },
      { key: 'name', label: 'Product Name', required: true },
      { key: 'cost_price', label: 'Cost Price', required: true },
      { key: 'selling_price', label: 'Selling Price', required: true },
      { key: 'unit', label: 'Unit' },
      { key: 'reorder_level', label: 'Reorder Level' },
      { key: 'status', label: 'Status' },
    ],
    async createRow(tx, organizationId, row) {
      const sku = required(row, 'sku');
      const name = required(row, 'name');
      const cost = decimalValue(value(row, 'cost_price'));
      const selling = decimalValue(value(row, 'selling_price'));
      const reorder = intValue(value(row, 'reorder_level'));
      const errors: string[] = [];
      if (!sku) errors.push('sku is required.');
      if (!name) errors.push('name is required.');
      if (cost === null) errors.push('cost_price must be a non-negative number.');
      if (selling === null) errors.push('selling_price must be a non-negative number.');
      if (value(row, 'reorder_level') && reorder === null) errors.push('reorder_level must be a whole number.');
      if (errors.length > 0) return { ok: false, errors };

      const existing = await tx.product.findFirst({
        where: { organizationId, sku: sku as string },
        select: { id: true },
      });
      if (existing) return { ok: true, errors: [], action: 'SKIP_DUPLICATE', recordId: existing.id };

      const product = await tx.product.create({
        data: {
          organizationId,
          sku: sku as string,
          name: name as string,
          costPrice: new PrismaNamespace.Decimal(cost as number),
          sellingPrice: new PrismaNamespace.Decimal(selling as number),
          unit: value(row, 'unit') || 'pcs',
          reorderLevel: reorder ?? 5,
          status: value(row, 'status') || 'ACTIVE',
        },
        select: { id: true },
      });
      return { ok: true, errors: [], action: 'CREATE', recordId: product.id };
    },
  },

  leads: {
    resourceType: 'leads',
    label: 'Leads',
    moduleKey: 'crm',
    permissions: ['data.import', 'crm.manage'],
    columns: [
      { key: 'title', label: 'Lead Title', required: true },
      { key: 'contact_name', label: 'Contact Name', required: true },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'estimated_value', label: 'Estimated Value' },
      { key: 'stage', label: 'Stage' },
    ],
    async createRow(tx, organizationId, row) {
      const title = required(row, 'title');
      const contactName = required(row, 'contact_name');
      const email = value(row, 'email');
      const estimated = decimalValue(value(row, 'estimated_value'));
      const errors: string[] = [];
      if (!title) errors.push('title is required.');
      if (!contactName) errors.push('contact_name is required.');
      if (email && !EMAIL_PATTERN.test(email)) errors.push('email is invalid.');
      if (value(row, 'estimated_value') && estimated === null) errors.push('estimated_value must be a number.');
      if (errors.length > 0) return { ok: false, errors };

      const existing = await tx.lead.findFirst({
        where: { organizationId, title: title as string, archivedAt: null },
        select: { id: true },
      });
      if (existing) return { ok: true, errors: [], action: 'SKIP_DUPLICATE', recordId: existing.id };

      const lead = await tx.lead.create({
        data: {
          organizationId,
          title: title as string,
          contactName: contactName as string,
          email: email || null,
          phone: value(row, 'phone') || null,
          estimatedValue: new PrismaNamespace.Decimal(estimated ?? 0),
          stage: value(row, 'stage') || 'NEW',
        },
        select: { id: true },
      });
      return { ok: true, errors: [], action: 'CREATE', recordId: lead.id };
    },
  },

  projects: {
    resourceType: 'projects',
    label: 'Projects',
    moduleKey: 'projects',
    permissions: ['data.import', 'projects.manage'],
    columns: [
      { key: 'name', label: 'Project Name', required: true },
      { key: 'description', label: 'Description' },
      { key: 'budget', label: 'Budget' },
      { key: 'start_date', label: 'Start Date' },
      { key: 'deadline', label: 'Deadline' },
      { key: 'status', label: 'Status' },
    ],
    async createRow(tx, organizationId, row) {
      const name = required(row, 'name');
      const budget = decimalValue(value(row, 'budget'));
      const startDate = dateValue(value(row, 'start_date'));
      const deadline = dateValue(value(row, 'deadline'));
      const errors: string[] = [];
      if (!name) errors.push('name is required.');
      if (value(row, 'budget') && budget === null) errors.push('budget must be a number.');
      if (value(row, 'start_date') && !startDate) errors.push('start_date must be a valid date.');
      if (value(row, 'deadline') && !deadline) errors.push('deadline must be a valid date.');
      if (errors.length > 0) return { ok: false, errors };

      const existing = await tx.project.findFirst({
        where: { organizationId, name: name as string },
        select: { id: true },
      });
      if (existing) return { ok: true, errors: [], action: 'SKIP_DUPLICATE', recordId: existing.id };

      const project = await tx.project.create({
        data: {
          organizationId,
          name: name as string,
          description: value(row, 'description') || null,
          budget: new PrismaNamespace.Decimal(budget ?? 0),
          startDate,
          deadline,
          status: value(row, 'status') || 'PLANNING',
        },
        select: { id: true },
      });
      return { ok: true, errors: [], action: 'CREATE', recordId: project.id };
    },
  },
};

export function getImportDefinition(resourceType: string): ImportDefinition | null {
  return IMPORT_DEFINITIONS[resourceType] ?? null;
}

export function suggestMapping(headers: string[], definition: ImportDefinition) {
  const mapping: Record<string, string> = {};
  for (const column of definition.columns) {
    const candidates = [column.key, column.label.toLowerCase().replace(/[^a-z0-9]+/g, '_'), ...(column.aliases ?? [])];
    const found = headers.find((header) => candidates.includes(header));
    if (found) mapping[column.key] = found;
  }
  return mapping;
}

export function applyMapping(
  row: Record<string, string>,
  mapping: Record<string, string>,
): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [target, source] of Object.entries(mapping)) {
    mapped[target] = row[source] ?? '';
  }
  return mapped;
}
