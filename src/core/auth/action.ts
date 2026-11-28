import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toUserErrorMessage } from '@/core/errors';
import { requireActionPermission } from './authorization';
import type { Permission, TenantSession } from '@/core/types';

/**
 * Server Action wrapper: enforces a server-side session/permission check,
 * revalidates the affected page, and converts errors into a safe query message
 * instead of leaking stack traces to the browser.
 */
export async function guardedAction(
  options: {
    permission: Permission | Permission[];
    revalidate?: string | string[];
    redirectTo?: string;
    successMessage?: string;
  },
  fn: (tenant: TenantSession) => Promise<void>,
): Promise<void> {
  let errorMessage: string | undefined;
  const permissions = Array.isArray(options.permission) ? options.permission : [options.permission];

  try {
    let tenant: TenantSession | undefined;
    for (const permission of permissions) {
      try {
        tenant = await requireActionPermission(permission);
        break;
      } catch {
        // Try the next accepted permission.
      }
    }
    if (!tenant) throw new Error('You do not have permission to perform this action.');

    await fn(tenant);
    const paths = options.revalidate
      ? Array.isArray(options.revalidate)
        ? options.revalidate
        : [options.revalidate]
      : [];
    for (const path of paths) revalidatePath(path);
  } catch (error) {
    errorMessage = toUserErrorMessage(error);
  }

  const target = options.redirectTo ?? '/dashboard';
  const url = new URL(target, 'http://localhost');
  if (errorMessage) {
    url.searchParams.set('error', errorMessage);
  } else if (options.successMessage) {
    url.searchParams.set('success', options.successMessage);
  }
  if (errorMessage || options.successMessage) redirect(url.pathname + url.search);
}

export function pageMessage(searchParams: Record<string, string | string[] | undefined>) {
  const error = searchParams.error;
  const success = searchParams.success;
  return {
    error: typeof error === 'string' ? error : undefined,
    success: typeof success === 'string' ? success : undefined,
  };
}
