import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ROLE_PERMISSIONS } from "../src/lib/permissions";

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
    update: { permissions: [...ROLE_PERMISSIONS.Admin] },
    create: {
      organizationId: org.id,
      name: "Admin",
      permissions: [...ROLE_PERMISSIONS.Admin],
      isSystem: true,
    },
  });

  await prisma.role.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "Manager" } },
    update: { permissions: [...ROLE_PERMISSIONS.Manager] },
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
    update: { permissions: [...ROLE_PERMISSIONS.Employee] },
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

  const warehouse = await prisma.warehouse.create({
    data: {
      organizationId: org.id,
      name: "Main Central Warehouse",
      location: "Dhaka",
    },
  });

  const p1 = await prisma.product.create({
    data: {
      organizationId: org.id,
      sku: "DL-101",
      name: "Enterprise Firewall X5",
      unit: "pcs",
      costPrice: 35000,
      sellingPrice: 48000,
      reorderLevel: 10,
    },
  });

  await prisma.stockItem.create({
    data: { productId: p1.id, warehouseId: warehouse.id, quantity: 30 },
  });

  const customer = await prisma.customer.create({
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

  const supplier = await prisma.supplier.create({
    data: {
      organizationId: org.id,
      name: "Global Tech Distributors",
      email: "supply@globaltech.com",
      phone: "+8801800000000",
    },
  });

  const project = await prisma.project.create({
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

  await prisma.employee.create({
    data: {
      organizationId: org.id,
      employeeCode: "EMP-101",
      fullName: "Tanvir Hasan",
      designation: "Operations Manager",
      department: "Operations",
      joiningDate: new Date("2025-01-15"),
      basicSalary: 45000,
    },
  });

  await prisma.accountTransaction.createMany({
    data: [
      {
        organizationId: org.id,
        type: "INCOME",
        category: "Sales Revenue",
        reference: "INV-1001",
        description: "Initial ERP License Advance",
        amount: 150000,
      },
      {
        organizationId: org.id,
        type: "EXPENSE",
        category: "Office & Cloud",
        reference: "EXP-201",
        description: "Cloud Server & Infrastructure",
        amount: 22000,
      },
    ],
  });

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
