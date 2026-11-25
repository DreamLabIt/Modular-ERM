import type { ReactNode } from 'react';

export const ROLES = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const PERMISSION_KEYS = [
  'hrm.view',
  'hrm.manage',
  'payroll.view',
  'payroll.manage',
  'crm.view',
  'crm.manage',
  'projects.view',
  'projects.manage',
  'accounting.view',
  'accounting.manage',
  'inventory.view',
  'inventory.manage',
  'sales_purchase.view',
  'sales_purchase.manage',
  'reports.view',
  'users_roles.view',
  'users_roles.manage',
  'settings.manage',
  'sales.view',
  'sales.create',
] as const;

export type Permission = (typeof PERMISSION_KEYS)[number];
export type PermissionGrant = Permission | '*';

export interface AuthenticatedRole {
  roleName: string;
  permissions: readonly string[];
}

export interface AuthUserFields {
  organizationId: string;
  roleName: string;
  permissions: string[];
}

export interface AuthenticatedSessionUser extends AuthUserFields {
  id: string;
}

export interface AuthTokenClaims {
  id?: string;
  organizationId?: string;
  roleName?: string;
  permissions?: string[];
}

export const ROLE_PERMISSIONS: Record<Role, readonly PermissionGrant[]> = {
  Admin: ['*'],
  Manager: [
    'hrm.view',
    'payroll.view',
    'crm.view',
    'projects.view',
    'inventory.view',
    'sales_purchase.view',
    'sales.view',
    'sales.create',
    'reports.view',
  ],
  Employee: ['hrm.view', 'projects.view'],
};

export type ModuleKey =
  | 'sales'
  | 'hrm'
  | 'payroll'
  | 'crm'
  | 'projects'
  | 'accounting'
  | 'inventory'
  | 'sales_purchase'
  | 'reports'
  | 'users_roles';

export interface ModuleNavItem {
  label: string;
  href: string;
  permission?: Permission;
}

export interface ERMModuleDefinition {
  key: ModuleKey;
  name: string;
  description: string;
  icon: string;
  basePath: string;
  permissions: Permission[];
  navItems: ModuleNavItem[];
}

export interface TenantSession {
  userId: string;
  name: string;
  email: string;
  roleName: string;
  organizationId: string;
  permissions: string[];
  organization: TenantOrganization;
  enabledModules: string[];
}

export interface TenantOrganization {
  id: string;
  name: string;
  logoUrl?: string | null;
  primaryColor: string;
  currency: string;
  plan: string;
}

export type DashboardPeriod = 'day' | 'month' | 'year';

export interface DashboardPeriodOption {
  label: string;
  value: DashboardPeriod;
}

export interface DashboardTransaction {
  id: string;
  type: string;
  category: string;
  reference: string | null;
  description: string;
  amount: number;
  date: string;
}

export interface DashboardRevenueInvoice {
  amount: number;
  date: string;
}

export interface DashboardProject {
  id: string;
  name: string;
  status: string;
  deadline: string | null;
  budget: number;
  customer: string;
}

export interface DashboardTaskStatusCount {
  status: ProjectTaskStatus;
  count: number;
}

export interface DashboardLeadStageCount {
  stage: string;
  count: number;
}

export interface DashboardInvoiceStatusCount {
  status: string;
  count: number;
}

export interface DashboardRecentInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  amount: number;
  date: string;
  customer: string;
}

export interface DashboardLowStockItem {
  productName: string;
  sku: string;
  quantity: number;
  reorderLevel: number;
  warehouse: string;
}

export interface DashboardTotals {
  employeeCount: number;
  managerCount: number;
  payroll: number;
  customerCount: number;
  projectCount: number;
  income: number;
  expense: number;
  productCount: number;
  invoiceTotal: number;
}

export interface DashboardData {
  totals: DashboardTotals;
  transactions: DashboardTransaction[];
  revenueInvoices: DashboardRevenueInvoice[];
  projects: DashboardProject[];
  taskSummary: DashboardTaskStatusCount[];
  lowStockItems: DashboardLowStockItem[];
  pendingLeaves: number;
  presentToday: number;
  leadSummary: DashboardLeadStageCount[];
  invoiceSummary: DashboardInvoiceStatusCount[];
  recentInvoices: DashboardRecentInvoice[];
  pendingPurchaseOrders: number;
}

export interface DashboardOverviewProps {
  data: DashboardData;
  userName: string;
  organizationName: string;
  currency: string;
  enabledModules: string[];
}

export interface DashboardTrendPoint {
  label: string;
  income: number;
  expense: number;
  revenue: number;
}

export interface DashboardChartEntry {
  name: string;
  value: number;
  color: string;
}

export interface DashboardDoughnutChartProps {
  data: DashboardChartEntry[];
  formatValue: (value: number) => string;
  emptyMessage: string;
}

export interface DashboardPanelProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
}

export interface LayoutProps {
  children: ReactNode;
}

export interface UpgradeModulePageProps {
  searchParams: {
    module?: string;
  };
}

export interface CreateTransactionInput {
  organizationId: string;
  type: string;
  category: string;
  reference: string | null;
  description: string;
  amount: number;
}

export interface CreateCrmCustomerInput {
  organizationId: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  status: string;
}

export interface CreateLeadInput {
  organizationId: string;
  title: string;
  contactName: string;
  email: string;
  estimatedValue: number;
  stage: string;
}

export interface CreateEmployeeInput {
  organizationId: string;
  employeeCode: string;
  fullName: string;
  designation: string;
  department: string;
  basicSalary: number;
}

export interface MarkAttendanceInput {
  organizationId: string;
  employeeId: string;
  status: string;
}

export interface CreateLeaveRequestInput {
  organizationId: string;
  employeeId: string;
  leaveType: string;
  startDate: Date;
  endDate: Date;
  days: number;
  reason: string;
}

export interface CreateProductInput {
  organizationId: string;
  sku: string;
  name: string;
  unit: string;
  costPrice: number;
  sellingPrice: number;
  initialStock: number;
}

export interface GeneratePayrollInput {
  organizationId: string;
  month: number;
  year: number;
  bonus: number;
  deductions: number;
}

export interface CreateProjectInput {
  organizationId: string;
  customerId: string | null;
  name: string;
  deadline: Date | null;
  budget: number;
}

export const PROJECT_TASK_STATUSES = [
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'COMPLETED',
] as const;

export type ProjectTaskStatus = (typeof PROJECT_TASK_STATUSES)[number];

export const PROJECT_TASK_STATUS_LABELS: Record<ProjectTaskStatus, string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'Review',
  COMPLETED: 'Completed',
};

export function isProjectTaskStatus(value: string): value is ProjectTaskStatus {
  return PROJECT_TASK_STATUSES.some((status) => status === value);
}

export interface TaskStatusSelectProps {
  taskId: string;
  taskTitle: string;
  status: ProjectTaskStatus;
}

export type UpdateTaskStatusResult =
  | { success: true }
  | { success: false; error: string };

export interface CreateProjectTaskInput {
  organizationId: string;
  projectId: string;
  title: string;
  assigneeName: string;
  assigneeEmployeeId: string | null;
  dueDate: Date | null;
  priority: string;
}

export interface CreateSalesCustomerInput {
  organizationId: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
}

export interface CreateInvoiceInput {
  organizationId: string;
  customerId: string;
  productId: string;
  quantity: number;
  taxPercent: number;
  enabledModules: string[];
}

export interface CreateSupplierInput {
  organizationId: string;
  name: string;
  email: string;
  phone: string;
}

export interface CreatePurchaseOrderInput {
  organizationId: string;
  supplierId: string;
  productId: string;
  quantity: number;
  enabledModules: string[];
}

export interface CreateRoleInput {
  organizationId: string;
  name: string;
  permissions: string[];
}

export interface CreateUserInput {
  organizationId: string;
  roleId: string;
  name: string;
  email: string;
  password: string;
}

export interface UpdateBrandingInput {
  organizationId: string;
  name: string;
  primaryColor: string;
  currency: string;
  address: string;
}

export interface RegisterOrganizationInput {
  companyName: string;
  ownerName: string;
  email: string;
  passwordHash: string;
  selectedModules: string[];
}

export interface SidebarProps {
  organizationName: string;
  organizationLogoUrl?: string | null;
  plan: string;
  userName: string;
  roleName: string;
  permissions: string[];
  activeModules: ERMModuleDefinition[];
}

export type EventHandler<T = unknown> = (payload: T) => Promise<void> | void;
