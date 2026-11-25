import type { ERMModuleDefinition } from '@/core/types';

export const MODULE_REGISTRY: Record<string, ERMModuleDefinition> = {
  sales: {
    key: 'sales',
    name: 'Sales',
    description: 'Customer billing and sales invoice management',
    icon: 'ShoppingCart',
    basePath: '/sales',
    permissions: ['sales.view', 'sales.create'],
    navItems: [
      { label: 'Customers', href: '/sales/customers', permission: 'sales.view' },
      { label: 'Sales Invoices', href: '/sales/invoices', permission: 'sales.view' },
    ],
  },
  hrm: {
    key: 'hrm',
    name: 'HR Management',
    description: 'Employee directory, daily attendance & leave management',
    icon: 'Users',
    basePath: '/hrm',
    permissions: ['hrm.view', 'hrm.manage'],
    navItems: [
      { label: 'Employees', href: '/hrm/employees', permission: 'hrm.view' },
      { label: 'Attendance', href: '/hrm/attendance', permission: 'hrm.view' },
      { label: 'Leave Requests', href: '/hrm/leaves', permission: 'hrm.view' },
    ],
  },
  payroll: {
    key: 'payroll',
    name: 'Payroll',
    description: 'Monthly salary sheets, bonuses, deductions & payouts',
    icon: 'Banknote',
    basePath: '/payroll',
    permissions: ['payroll.view', 'payroll.manage'],
    navItems: [
      { label: 'Salary & Bonus Runs', href: '/payroll/runs', permission: 'payroll.view' },
    ],
  },
  crm: {
    key: 'crm',
    name: 'CRM',
    description: 'Customer & client management and sales leads pipeline',
    icon: 'Handshake',
    basePath: '/crm',
    permissions: ['crm.view', 'crm.manage'],
    navItems: [
      { label: 'Customers & Clients', href: '/crm/customers', permission: 'crm.view' },
      { label: 'Leads Pipeline', href: '/crm/leads', permission: 'crm.view' },
    ],
  },
  projects: {
    key: 'projects',
    name: 'Project Management',
    description: 'Projects, task assignments, priorities & deadlines',
    icon: 'FolderKanban',
    basePath: '/projects',
    permissions: ['projects.view', 'projects.manage'],
    navItems: [
      { label: 'Projects & Tasks', href: '/projects', permission: 'projects.view' },
    ],
  },
  accounting: {
    key: 'accounting',
    name: 'Accounting',
    description: 'Income, expense tracking & real-time profit/loss ledger',
    icon: 'Calculator',
    basePath: '/accounting',
    permissions: ['accounting.view', 'accounting.manage'],
    navItems: [
      { label: 'Income, Expense & P&L', href: '/accounting', permission: 'accounting.view' },
    ],
  },
  inventory: {
    key: 'inventory',
    name: 'Inventory',
    description: 'Products catalog, stock levels & warehouse adjustments',
    icon: 'Package',
    basePath: '/inventory',
    permissions: ['inventory.view', 'inventory.manage'],
    navItems: [
      { label: 'Products & Stock', href: '/inventory/products', permission: 'inventory.view' },
    ],
  },
  sales_purchase: {
    key: 'sales_purchase',
    name: 'Sales & Purchase',
    description: 'Sales invoices, purchase orders & supplier management',
    icon: 'ShoppingCart',
    basePath: '/sales-purchase',
    permissions: [
      'sales_purchase.view',
      'sales_purchase.manage',
      'sales_purchase.invoice.view',
      'sales_purchase.invoice.create',
      'sales_purchase.invoice.edit',
      'sales_purchase.invoice.issue',
      'sales_purchase.invoice.payment.record',
      'sales_purchase.invoice.payment.view',
      'sales_purchase.invoice.cancel',
    ],
    navItems: [
      { label: 'Sales Invoices', href: '/sales-purchase/invoices', permission: 'sales_purchase.view' },
      { label: 'Purchase Orders', href: '/sales-purchase/purchases', permission: 'sales_purchase.view' },
    ],
  },
  reports: {
    key: 'reports',
    name: 'Reports',
    description: 'Executive business analytics, revenue & HR summaries',
    icon: 'BarChart3',
    basePath: '/reports',
    permissions: ['reports.view'],
    navItems: [
      { label: 'Business Analytics', href: '/reports', permission: 'reports.view' },
    ],
  },
  users_roles: {
    key: 'users_roles',
    name: 'User & Role',
    description: 'Admin, manager & employee roles and permission control',
    icon: 'ShieldCheck',
    basePath: '/users-roles',
    permissions: ['users_roles.view', 'users_roles.manage'],
    navItems: [
      { label: 'Users & Permissions', href: '/users-roles', permission: 'users_roles.view' },
    ],
  },
};

export function getActiveModulesForTenant(enabledKeys: string[]): ERMModuleDefinition[] {
  return Object.values(MODULE_REGISTRY).filter((mod) => enabledKeys.includes(mod.key));
}
