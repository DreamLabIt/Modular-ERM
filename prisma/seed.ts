import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ROLE_PERMISSIONS } from "../src/core/types";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: "dreamlab-it" },
    update: {
      logoUrl:
        "https://dreamlabit.com/wp-content/uploads/2025/11/Logo-Dreamlab-IT.svg",
    },
    create: {
      name: "DreamLab IT",
      slug: "dreamlab-it",
      logoUrl:
        "https://dreamlabit.com/wp-content/uploads/2025/11/Logo-Dreamlab-IT.svg",
      primaryColor: "#2563eb",
      currency: "BDT",
      address: "Dhaka, Bangladesh",
      plan: "ENTERPRISE",
    },
  });

  const adminRole = await prisma.role.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "Admin" } },
    update: { isSystem: true },
    create: {
      organizationId: org.id,
      name: "Admin",
      permissions: [...ROLE_PERMISSIONS.Admin],
      isSystem: true,
    },
  });

  await prisma.role.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "Manager" } },
    update: { isSystem: true, permissions: [...ROLE_PERMISSIONS.Manager] },
    create: {
      organizationId: org.id,
      name: "Manager",
      permissions: [...ROLE_PERMISSIONS.Manager],
      isSystem: true,
    },
  });

  await prisma.role.upsert({
    where: {
      organizationId_name: { organizationId: org.id, name: "Employee" },
    },
    update: { isSystem: true },
    create: {
      organizationId: org.id,
      name: "Employee",
      permissions: [...ROLE_PERMISSIONS.Employee],
      isSystem: true,
    },
  });

  const passwordHash = await bcrypt.hash("Admin@123", 10);
  await prisma.user.upsert({
    where: { email: "admin@demo-corp.com" },
    update: {},
    create: {
      organizationId: org.id,
      roleId: adminRole.id,
      name: "Md Toafael",
      email: "admin@demo-corp.com",
      passwordHash,
    },
  });

  const allModules = [
    "hrm",
    "payroll",
    "crm",
    "projects",
    "accounting",
    "inventory",
    "sales",
    "sales_purchase",
    "reports",
    "users_roles",
  ];

  for (const moduleKey of allModules) {
    await prisma.organizationModule.upsert({
      where: {
        organizationId_moduleKey: { organizationId: org.id, moduleKey },
      },
      update: { isEnabled: true },
      create: {
        organizationId: org.id,
        moduleKey,
        isEnabled: true,
      },
    });
  }

  let warehouse = await prisma.warehouse.findFirst({
    where: { organizationId: org.id, name: "Main Central Warehouse" },
  });
  if (!warehouse) {
    warehouse = await prisma.warehouse.create({
      data: {
        organizationId: org.id,
        name: "Main Central Warehouse",
        location: "Dhaka",
      },
    });
  }

  const p1 = await prisma.product.upsert({
    where: {
      organizationId_sku: { organizationId: org.id, sku: "DL-101" },
    },
    update: {
      name: "Enterprise Firewall X5",
      unit: "pcs",
      costPrice: 35000,
      sellingPrice: 48000,
      reorderLevel: 10,
    },
    create: {
      organizationId: org.id,
      sku: "DL-101",
      name: "Enterprise Firewall X5",
      unit: "pcs",
      costPrice: 35000,
      sellingPrice: 48000,
      reorderLevel: 10,
    },
  });

  await prisma.stockItem.upsert({
    where: {
      organizationId_productId_warehouseId: {
        organizationId: org.id,
        productId: p1.id,
        warehouseId: warehouse.id,
      },
    },
    update: { quantity: 30 },
    create: {
      organizationId: org.id,
      productId: p1.id,
      warehouseId: warehouse.id,
      quantity: 30,
    },
  });

  let customer = await prisma.customer.findFirst({
    where: { organizationId: org.id, email: "info@goldenroots.com" },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        organizationId: org.id,
        name: "Golden Roots Agro Ltd.",
        company: "Smart Group",
        email: "info@goldenroots.com",
        phone: "+8801700000000",
        address: "Dhaka, Bangladesh",
        status: "VIP",
      },
    });
  }

  const existingLead = await prisma.lead.findFirst({
    where: { organizationId: org.id, title: "Full Agro ERP Implementation" },
  });
  if (!existingLead) {
    await prisma.lead.create({
      data: {
        organizationId: org.id,
        title: "Full Agro ERP Implementation",
        contactName: "Managing Director",
        email: "md@smartgroup.com",
        estimatedValue: 450000,
        stage: "PROPOSAL",
      },
    });
  }

  const existingSupplier = await prisma.supplier.findFirst({
    where: { organizationId: org.id, email: "supply@globaltech.com" },
  });
  if (!existingSupplier) {
    await prisma.supplier.create({
      data: {
        organizationId: org.id,
        name: "Global Tech Distributors",
        email: "supply@globaltech.com",
        phone: "+8801800000000",
      },
    });
  }

  let project = await prisma.project.findFirst({
    where: { organizationId: org.id, name: "Enterprise Web & ERM Portal" },
  });
  if (!project) {
    project = await prisma.project.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        name: "Enterprise Web & ERM Portal",
        description: "Custom multi-module deployment and training",
        deadline: new Date("2026-12-25"),
        budget: 250000,
        status: "IN_PROGRESS",
      },
    });
  }

  const existingTask = await prisma.projectTask.findFirst({
    where: {
      organizationId: org.id,
      projectId: project.id,
      title: "Database Schema & Role Matrix Setup",
    },
  });
  if (!existingTask) {
    await prisma.projectTask.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        title: "Database Schema & Role Matrix Setup",
        assigneeName: "Tanvir Hasan",
        dueDate: new Date("2026-11-30"),
        priority: "HIGH",
        status: "IN_PROGRESS",
      },
    });
  }

  await prisma.employee.upsert({
    where: {
      organizationId_employeeCode: {
        organizationId: org.id,
        employeeCode: "EMP-101",
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      employeeCode: "EMP-101",
      fullName: "Tanvir Hasan",
      designation: "Operations Manager",
      department: "Operations",
      joiningDate: new Date("2025-01-15"),
      basicSalary: 45000,
    },
  });

  const existingIncome = await prisma.accountTransaction.findFirst({
    where: { organizationId: org.id, reference: "INV-1001" },
  });
  const existingExpense = await prisma.accountTransaction.findFirst({
    where: { organizationId: org.id, reference: "EXP-201" },
  });

  const txToCreate = [];
  if (!existingIncome) {
    txToCreate.push({
      organizationId: org.id,
      type: "INCOME",
      category: "Sales Revenue",
      reference: "INV-1001",
      description: "Initial ERP License Advance",
      amount: 150000,
    });
  }
  if (!existingExpense) {
    txToCreate.push({
      organizationId: org.id,
      type: "EXPENSE",
      category: "Office & Cloud",
      reference: "EXP-201",
      description: "Cloud Server & Infrastructure",
      amount: 22000,
    });
  }
  if (txToCreate.length > 0) {
    await prisma.accountTransaction.createMany({ data: txToCreate });
  }

  // Enterprise infrastructure defaults. Idempotent: re-running the seed keeps
  // any administrator customisations while filling in missing rows.
  await prisma.organizationSettings.upsert({
    where: { organizationId: org.id },
    update: {},
    create: {
      organizationId: org.id,
      currencyCode: org.currency || "BDT",
      currencySymbol: org.currency === "USD" ? "$" : "৳",
    },
  });

  const defaultSequences = [
    { documentType: "SALES_INVOICE", prefix: "INV" },
    { documentType: "PURCHASE_ORDER", prefix: "PO" },
    { documentType: "QUOTATION", prefix: "QT" },
    { documentType: "PAYMENT_RECEIPT", prefix: "PAY" },
    { documentType: "CREDIT_NOTE", prefix: "CN" },
    { documentType: "DEBIT_NOTE", prefix: "DN" },
    { documentType: "JOURNAL_ENTRY", prefix: "JE" },
    { documentType: "PAYROLL_RUN", prefix: "PRUN" },
    { documentType: "PURCHASE_REQUISITION", prefix: "PR" },
  ];
  for (const sequence of defaultSequences) {
    await prisma.documentSequence.upsert({
      where: {
        organizationId_documentType: {
          organizationId: org.id,
          documentType: sequence.documentType,
        },
      },
      update: {},
      create: { organizationId: org.id, ...sequence },
    });
  }

  const defaultRetention = [
    { dataType: "AUDIT_LOG", retentionDays: 365, action: "DELETE" },
    { dataType: "LOGIN_HISTORY", retentionDays: 180, action: "ANONYMIZE" },
    { dataType: "NOTIFICATION_HISTORY", retentionDays: 90, action: "DELETE" },
    { dataType: "SESSION_HISTORY", retentionDays: 90, action: "DELETE" },
    { dataType: "IMPORT_EXPORT_FILES", retentionDays: 30, action: "DELETE" },
  ];
  for (const policy of defaultRetention) {
    await prisma.dataRetentionPolicy.upsert({
      where: {
        organizationId_dataType: { organizationId: org.id, dataType: policy.dataType },
      },
      update: {},
      create: { organizationId: org.id, ...policy, isActive: false },
    });
  }

  console.log("Seed completed! Login: admin@demo-corp.com / Admin@123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
