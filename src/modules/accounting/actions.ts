'use server';

import { revalidatePath } from 'next/cache';
import { assertActionAccess, requireModuleAccess } from '@/core/auth/module-guard';
import { toUserErrorMessage, type ActionResult } from '@/core/errors';
import { cuidIdSchema, formatZodError, getFormValue } from '@/core/validation';
import {
  createAccountSchema,
  createBankAccountSchema,
  createBankTransactionSchema,
  createJournalEntrySchema,
  createReconciliationSchema,
} from './schema';
import {
  createAccount,
  createBankAccount,
  createTransaction,
  reconcileBankAccount,
  recordBankTransaction,
  toggleAccountActive,
} from './model';
import { createJournalEntry, postDraftJournalEntry, reverseJournalEntry } from './service';

function revalidateAccountingRoutes() {
  revalidatePath('/accounting');
  revalidatePath('/accounting/accounts');
  revalidatePath('/accounting/journals');
  revalidatePath('/accounting/banking');
  revalidatePath('/accounting/statements');
  revalidatePath('/reports');
  revalidatePath('/dashboard');
}

export async function createTransactionAction(formData: FormData): Promise<void> {
  const tenant = await requireModuleAccess('accounting', 'accounting.manage');
  const type = getFormValue(formData, 'type') || 'INCOME';
  const category = getFormValue(formData, 'category').trim() || 'General';
  const reference = getFormValue(formData, 'reference').trim();
  const description = getFormValue(formData, 'description').trim();
  const amount = Number(formData.get('amount') || 0);

  if (!description || !Number.isFinite(amount) || amount <= 0) return;

  await createTransaction(
    {
      organizationId: tenant.organizationId,
      type: type === 'EXPENSE' ? 'EXPENSE' : 'INCOME',
      category,
      reference: reference || null,
      description,
      amount,
    },
    tenant.userId,
  );
  revalidateAccountingRoutes();
}

export async function createAccountAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const tenant = await assertActionAccess('accounting', ['accounting.coa.manage', 'accounting.manage']);
    const parsed = createAccountSchema.safeParse({
      code: getFormValue(formData, 'code'),
      name: getFormValue(formData, 'name'),
      type: getFormValue(formData, 'type'),
      parentId: getFormValue(formData, 'parentId') || undefined,
      description: getFormValue(formData, 'description') || undefined,
    });
    if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };

    const result = await createAccount({
      organizationId: tenant.organizationId,
      ...parsed.data,
      actorUserId: tenant.userId,
    });
    if (!result.success) return result;
    revalidateAccountingRoutes();
    return { success: true, data: { id: result.data.id } };
  } catch (err) {
    return { success: false, error: toUserErrorMessage(err) };
  }
}

export async function toggleAccountActiveAction(accountId: string, isActive: boolean): Promise<ActionResult> {
  try {
    const tenant = await assertActionAccess('accounting', ['accounting.coa.manage', 'accounting.manage']);
    const parsedId = cuidIdSchema.safeParse(accountId);
    if (!parsedId.success) return { success: false, error: 'Invalid account ID.' };
    const result = await toggleAccountActive(tenant.organizationId, parsedId.data, isActive, tenant.userId);
    if (!result.success) return result;
    revalidateAccountingRoutes();
    return { success: true };
  } catch (err) {
    return { success: false, error: toUserErrorMessage(err) };
  }
}

export async function createJournalEntryAction(formData: FormData): Promise<ActionResult<{ id: string; entryNumber: string }>> {
  try {
    const tenant = await assertActionAccess('accounting', ['accounting.journal.create', 'accounting.manage']);
    let linesRaw: unknown = [];
    try {
      linesRaw = JSON.parse(getFormValue(formData, 'lines') || '[]');
    } catch {
      return { success: false, error: 'Invalid journal lines format.' };
    }
    const postImmediately = getFormValue(formData, 'postImmediately') === 'true';
    if (postImmediately) {
      await assertActionAccess('accounting', ['accounting.journal.post', 'accounting.manage']);
    }

    const parsed = createJournalEntrySchema.safeParse({
      entryDate: getFormValue(formData, 'entryDate'),
      description: getFormValue(formData, 'description'),
      reference: getFormValue(formData, 'reference') || undefined,
      postImmediately,
      lines: linesRaw,
    });
    if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };

    const result = await createJournalEntry({
      organizationId: tenant.organizationId,
      entryDate: parsed.data.entryDate,
      description: parsed.data.description,
      reference: parsed.data.reference,
      postImmediately: parsed.data.postImmediately,
      actorUserId: tenant.userId,
      lines: parsed.data.lines,
    });
    if (!result.success) return result;
    revalidateAccountingRoutes();
    return { success: true, data: { id: result.data.id, entryNumber: result.data.entryNumber } };
  } catch (err) {
    return { success: false, error: toUserErrorMessage(err) };
  }
}

export async function postJournalEntryAction(journalEntryId: string): Promise<ActionResult> {
  try {
    const tenant = await assertActionAccess('accounting', ['accounting.journal.post', 'accounting.manage']);
    const parsedId = cuidIdSchema.safeParse(journalEntryId);
    if (!parsedId.success) return { success: false, error: 'Invalid journal entry.' };
    const result = await postDraftJournalEntry({
      organizationId: tenant.organizationId,
      journalEntryId: parsedId.data,
      actorUserId: tenant.userId,
    });
    if (!result.success) return result;
    revalidateAccountingRoutes();
    return { success: true };
  } catch (err) {
    return { success: false, error: toUserErrorMessage(err) };
  }
}

export async function reverseJournalEntryAction(journalEntryId: string, reason?: string): Promise<ActionResult> {
  try {
    const tenant = await assertActionAccess('accounting', ['accounting.journal.reverse', 'accounting.manage']);
    const parsedId = cuidIdSchema.safeParse(journalEntryId);
    if (!parsedId.success) return { success: false, error: 'Invalid journal entry.' };
    const result = await reverseJournalEntry({
      organizationId: tenant.organizationId,
      journalEntryId: parsedId.data,
      actorUserId: tenant.userId,
      reason: reason?.trim().slice(0, 300),
    });
    if (!result.success) return result;
    revalidateAccountingRoutes();
    return { success: true };
  } catch (err) {
    return { success: false, error: toUserErrorMessage(err) };
  }
}

export async function createBankAccountAction(formData: FormData): Promise<ActionResult> {
  try {
    const tenant = await assertActionAccess('accounting', ['accounting.bank.manage', 'accounting.manage']);
    const parsed = createBankAccountSchema.safeParse({
      accountId: getFormValue(formData, 'accountId'),
      bankName: getFormValue(formData, 'bankName'),
      accountNumber: getFormValue(formData, 'accountNumber'),
      accountType: getFormValue(formData, 'accountType') || 'BANK',
      currency: getFormValue(formData, 'currency') || tenant.organization.currency,
      openingBalance: formData.get('openingBalance') ?? 0,
    });
    if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };
    const result = await createBankAccount({
      organizationId: tenant.organizationId,
      ...parsed.data,
      actorUserId: tenant.userId,
    });
    if (!result.success) return result;
    revalidateAccountingRoutes();
    return { success: true };
  } catch (err) {
    return { success: false, error: toUserErrorMessage(err) };
  }
}

export async function recordBankTransactionAction(formData: FormData): Promise<ActionResult> {
  try {
    const tenant = await assertActionAccess('accounting', ['accounting.bank.manage', 'accounting.manage']);
    const parsed = createBankTransactionSchema.safeParse({
      bankAccountId: getFormValue(formData, 'bankAccountId'),
      transactionDate: getFormValue(formData, 'transactionDate'),
      type: getFormValue(formData, 'type'),
      amount: formData.get('amount'),
      reference: getFormValue(formData, 'reference') || undefined,
      description: getFormValue(formData, 'description'),
      counterAccountId: getFormValue(formData, 'counterAccountId') || undefined,
    });
    if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };
    const result = await recordBankTransaction({
      organizationId: tenant.organizationId,
      ...parsed.data,
      actorUserId: tenant.userId,
    });
    if (!result.success) return result;
    revalidateAccountingRoutes();
    return { success: true };
  } catch (err) {
    return { success: false, error: toUserErrorMessage(err) };
  }
}

export async function reconcileBankAccountAction(formData: FormData): Promise<ActionResult> {
  try {
    const tenant = await assertActionAccess('accounting', ['accounting.bank.manage', 'accounting.manage']);
    let ids: string[] = [];
    try {
      const raw = getFormValue(formData, 'reconcileTransactionIds');
      if (raw) ids = JSON.parse(raw) as string[];
    } catch {
      return { success: false, error: 'Invalid transaction selection.' };
    }
    const parsed = createReconciliationSchema.safeParse({
      bankAccountId: getFormValue(formData, 'bankAccountId'),
      statementDate: getFormValue(formData, 'statementDate'),
      statementBalance: formData.get('statementBalance'),
      notes: getFormValue(formData, 'notes') || undefined,
      reconcileTransactionIds: ids,
    });
    if (!parsed.success) return { success: false, error: formatZodError(parsed.error) };
    const result = await reconcileBankAccount({
      organizationId: tenant.organizationId,
      ...parsed.data,
      actorUserId: tenant.userId,
    });
    if (!result.success) return result;
    revalidateAccountingRoutes();
    return { success: true };
  } catch (err) {
    return { success: false, error: toUserErrorMessage(err) };
  }
}
