import DashboardOverview from "@/app/components/dashboard/dashboard-overview";
import { getRequiredTenantSession } from "@/core/auth/session";
import { getDashboardMetrics } from "@/modules/dashboard/model";

export default async function DashboardOverviewPage() {
  const tenant = await getRequiredTenantSession();

  const data = await getDashboardMetrics(tenant.organizationId);

  return (
    <DashboardOverview
      data={data}
      userName={tenant.name}
      organizationName={tenant.organization.name}
      currency={tenant.organization.currency}
      enabledModules={tenant.enabledModules}
    />
  );
}
