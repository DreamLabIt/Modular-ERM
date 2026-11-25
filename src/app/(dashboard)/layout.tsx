import type { LayoutProps } from "@/core/types";
import { getRequiredTenantSession } from "@/core/auth/session";
import { getActiveModulesForTenant } from "@/core/modules/registry";
import { Sidebar } from "@/core/ui/Sidebar";

export default async function DashboardLayout({
  children,
}: LayoutProps) {
  const tenant = await getRequiredTenantSession();

  const activeModules = getActiveModulesForTenant(tenant.enabledModules);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background lg:flex-row">
      <Sidebar
        organizationName={tenant.organization.name}
        organizationLogoUrl={tenant.organization.logoUrl}
        plan={tenant.organization.plan}
        userName={tenant.name}
        roleName={tenant.roleName}
        permissions={tenant.permissions}
        activeModules={activeModules}
      />

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain p-4 sm:p-6 md:p-8">
        {children}
      </main>
    </div>
  );
}
