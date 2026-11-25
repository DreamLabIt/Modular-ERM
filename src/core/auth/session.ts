import { auth } from "./auth";
import { redirect } from "next/navigation";
import { findTenantOrganization } from './model';
import type { TenantSession } from '@/core/types';

export type { TenantSession } from '@/core/types';

export async function getRequiredTenantSession(): Promise<TenantSession> {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user;
  if (!user.roleName || !Array.isArray(user.permissions)) redirect('/login');
  const org = await findTenantOrganization(user.organizationId);

  if (!org || !org.isActive) redirect("/login");

  return {
    userId: user.id,
    name: user.name ?? '',
    email: user.email ?? '',
    roleName: user.roleName,
    organizationId: org.id,
    permissions: user.permissions,
    organization: {
      id: org.id,
      name: org.name,
      logoUrl: org.logoUrl,
      primaryColor: org.primaryColor,
      currency: org.currency,
      plan: org.plan,
    },
    enabledModules: org.modules.map((m) => m.moduleKey),
  };
}
