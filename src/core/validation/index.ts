import { z } from 'zod';

export const cuidIdSchema = z
  .string()
  .trim()
  .min(1, 'Identifier is required.')
  .max(64, 'Identifier is too long.');

export const nonEmptyString = (label: string, max = 200) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be at most ${max} characters.`);

export const optionalText = (max = 1000) =>
  z
    .string()
    .trim()
    .max(max, `Text must be at most ${max} characters.`)
    .optional()
    .transform((val) => (val && val.length > 0 ? val : undefined));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(254, 'Email is too long.');

export const optionalEmailSchema = z
  .string()
  .trim()
  .max(254)
  .optional()
  .transform((val) => (val && val.length > 0 ? val.toLowerCase() : undefined))
  .refine((val) => !val || z.string().email().safeParse(val).success, {
    message: 'Enter a valid email address.',
  });

export const phoneSchema = z
  .string()
  .trim()
  .max(32, 'Phone number is too long.')
  .regex(/^[+0-9()\-\s]*$/, 'Enter a valid phone number.')
  .optional()
  .transform((val) => (val && val.length > 0 ? val : undefined));

export const positiveIntSchema = z.coerce
  .number()
  .refine(Number.isFinite, 'Value must be a finite number.')
  .refine(Number.isInteger, 'Value must be a whole number.')
  .refine((n) => n > 0 && n <= 1_000_000_000, 'Value must be a positive whole number.');

export const nonNegativeIntSchema = z.coerce
  .number()
  .refine(Number.isFinite, 'Value must be a finite number.')
  .refine(Number.isInteger, 'Value must be a whole number.')
  .refine((n) => n >= 0 && n <= 1_000_000_000, 'Value must be zero or a positive whole number.');

export const positiveMoneySchema = z.coerce
  .number()
  .refine(Number.isFinite, 'Amount must be a valid number.')
  .refine((n) => n > 0 && n <= 999_999_999_999.99, 'Amount must be greater than zero.');

export const nonNegativeMoneySchema = z.coerce
  .number()
  .refine(Number.isFinite, 'Amount must be a valid number.')
  .refine((n) => n >= 0 && n <= 999_999_999_999.99, 'Amount cannot be negative.');

export const dateStringSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date (YYYY-MM-DD).')
  .transform((val) => {
    const parsed = new Date(`${val}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('Invalid date.');
    }
    return parsed;
  });

export const optionalDateStringSchema = z
  .string()
  .trim()
  .optional()
  .transform((val, ctx) => {
    if (!val) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a valid date (YYYY-MM-DD).',
      });
      return z.NEVER;
    }
    const parsed = new Date(`${val}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid date.',
      });
      return z.NEVER;
    }
    return parsed;
  });

export const percentageSchema = z.coerce
  .number()
  .min(0, 'Percentage cannot be negative.')
  .max(100, 'Percentage cannot exceed 100.')
  .refine(Number.isFinite, 'Percentage must be a valid number.');

export function formatZodError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'Invalid input.';
  return first.message;
}

export function getFormValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}
