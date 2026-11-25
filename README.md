# Commercial Multi-Tenant Modular ERM v2 (Full 9-Module Suite)

Full-featured, white-label, multi-tenant Enterprise Resource Management (ERM) built with Next.js 14 App Router, Prisma ORM, PostgreSQL, and NextAuth.

## Complete Module List (All 9 Modules Included)
1. **HR Management (`hrm`)**: Employees, Daily Attendance, Leave Requests & Approvals
2. **Payroll (`payroll`)**: Monthly Salary Runs, Bonuses, Deductions, Net Pay & Disbursement
3. **CRM (`crm`)**: Leads, Pipeline Stages & Customer/Client Management
4. **Project Management (`projects`)**: Client/Internal Projects, Tasks & Deadlines
5. **Accounting (`accounting`)**: Income, Expense Tracking & Real-time Profit/Loss Calculation
6. **Inventory (`inventory`)**: Products, Stock Levels & Warehouse Stock Adjustments
7. **Sales & Purchase (`sales_purchase`)**: Sales Invoices (auto stock deduction) & Purchase Orders (auto stock addition)
8. **Reports (`reports`)**: Cross-module Business Analytics & Financial Summaries
9. **User & Role (`users_roles`)**: Admin, Manager, Employee Role Creation, Permissions Matrix & User Provisioning

## Server Architecture
- `src/app/**/page.tsx` contains the Next.js views.
- `src/modules/**/actions.ts` contains server-action controllers for authorization, input handling, and route revalidation.
- `src/modules/**/model.ts` contains Prisma reads and writes for each feature.
- Shared application and domain types live in `src/core/types/index.ts`, including module inputs, permissions, auth/session contracts, dashboard data, and reusable component props. Feature modules should import shared types from `@/core/types` instead of defining duplicate contracts locally. NextAuth module augmentation stays in `src/types/next-auth.d.ts` and extends those shared auth types.
- Authorization is based on the authenticated user's active organization role and permission grants stored in PostgreSQL. Role names do not imply permissions. Every session resolution reloads the user, role permissions, and active states from the database, so permission or role changes take effect on the user's next request without trusting stale JWT permission claims.
- Role creation, permission updates, activation/deactivation, deletion, user provisioning, and user-role changes are organization-scoped and guarded by `users_roles.manage`. An administrator can delegate only permissions already granted to their own role. System roles cannot be renamed, deactivated, or deleted; a role with assigned users cannot be deactivated or deleted. Successful role and user-role changes write transactional records to `SecurityAuditLog`.

## Local Setup
1. Rename `.env.example` to `.env` and update `DATABASE_URL`.
2. Run:
   ```bash
   npm install
   npx prisma db push
   npm run db:seed
   npm run dev
   ```
3. Login at `http://localhost:3000`:
   - **Email:** `admin@demo-corp.com`
   - **Password:** `Admin@123`

### Existing Database Upgrade

For an existing database created from the previous schema, back up the database
and inspect the SQL migrations before applying them. Run
`npx prisma migrate deploy` before `npx prisma db push`. The project-task
migration converts legacy `DONE` task statuses to `COMPLETED`, adds the optional
employee assignment relation without changing existing assignee names, and
stops if it finds any unsupported task status values. The permission migration
adds role activation/version fields and transactional security audit storage,
and replaces the user-role foreign key with a tenant-scoped relation. It stops
if it finds orphaned or cross-organization user-role assignments; resolve those
records explicitly before retrying instead of bypassing the check.

After updating the schema, validate it and regenerate Prisma Client:
```bash
npx prisma validate
npx prisma generate
```

The seed command creates missing system roles and marks existing system roles,
but preserves permission changes already stored for existing roles. It is not
a permission reset mechanism. Production applications should use migrations;
do not apply migrations to a database until its backup and migration plan have
been reviewed.

### Authorization Tests

Run the permission evaluation and delegation tests with:
```bash
npm test
```
