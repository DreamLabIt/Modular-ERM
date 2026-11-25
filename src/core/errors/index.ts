import { Prisma } from '@prisma/client';

export type ActionResult<T = undefined> =
  | (T extends undefined
      ? { success: true; message?: string }
      : { success: true; message?: string; data: T })
  | { success: false; error: string };

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code = 'APP_ERROR', statusCode = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(message, 'FORBIDDEN', 403);
    this.name = 'AuthorizationError';
  }
}

export class TenantScopeError extends AppError {
  constructor(message = 'Requested resource was not found in your organization.') {
    super(message, 'TENANT_SCOPE_ERROR', 404);
    this.name = 'TenantScopeError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409);
    this.name = 'ConflictError';
  }
}

export class InsufficientStockError extends AppError {
  constructor(message: string) {
    super(message, 'INSUFFICIENT_STOCK', 409);
    this.name = 'InsufficientStockError';
  }
}

/**
 * Converts unknown runtime/database errors into safe, user-facing messages
 * without leaking SQL, schema names, stack traces, or internal identifiers.
 */
export function toUserErrorMessage(
  error: unknown,
  fallback = 'An unexpected error occurred. Please try again.',
): string {
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return 'A record with the same unique identifier already exists.';
    }
    if (error.code === 'P2003') {
      return 'Referenced record could not be linked or is still in use.';
    }
    if (error.code === 'P2025') {
      return 'The requested record was not found.';
    }
    if (error.code === 'P2034') {
      return 'A concurrent update occurred. Please reload and retry.';
    }
    return fallback;
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return 'Submitted data could not be processed. Check your inputs and retry.';
  }
  if (error instanceof Error) {
    // Only surface plain validation/domain messages, never raw Prisma/pg internals
    if (
      error.message.includes('Prisma') ||
      error.message.includes('SELECT ') ||
      error.message.includes('INSERT ') ||
      error.message.includes('UPDATE ') ||
      error.message.includes('DELETE ') ||
      error.message.includes('ECONNREFUSED')
    ) {
      return fallback;
    }
    return error.message;
  }
  return fallback;
}
