import type { TenantSession } from '@/core/types';
import { TenantScopeError } from '@/core/errors';

/**
 * Tenant-scoping helpers. Every tenant-owned query must include an
 * organizationId filter derived from the authenticated server-side session.
 * Never accept organizationId from a client payload without this check.
 */

export interface TenantScope {
  organizationId: string;
}

export function tenantScope(tenant: Pick<TenantSession, 'organizationId'>): TenantScope {
  return { organizationId: tenant.organizationId };
}

export function tenantWhere<T extends Record<string, unknown>>(
  organizationId: string,
  where: T = {} as T,
): T & { organizationId: string } {
  return { ...where, organizationId };
}

export function assertOrganizationMatch(
  expectedOrganizationId: string,
  ...actualOrganizationIds: Array<string | null | undefined>
): void {
  for (const actual of actualOrganizationIds) {
    if (actual && actual !== expectedOrganizationId) {
      throw new TenantScopeError();
    }
  }
}

export function requireTenantRecord<T>(
  record: T | null | undefined,
  message?: string,
): T {
  if (!record) {
    throw new TenantScopeError(message);
  }
  return record;
}

/**
 * Verifies that all supplied related record ids belong to the tenant. Callers
 * pass the ids returned by a tenant-scoped lookup; this function is a final
 * guard against cross-tenant relation creation.
 */
export function assertAllBelongToTenant(
  expectedOrganizationId: string,
  records: Array<{ organizationId: string } | null | undefined>,
): void {
  for (const record of records) {
    if (!record) throw new TenantScopeError();
    if (record.organizationId !== expectedOrganizationId) {
      throw new TenantScopeError();
    }
  }
}
