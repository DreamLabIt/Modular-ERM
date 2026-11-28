'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/core/auth/module-guard';
import { MODULE_REGISTRY } from '@/core/modules/registry';
import { setModuleEnabled, updateBranding } from '@/modules/settings/model';

export async function updateBrandingAction(formData: FormData): Promise<void> {
  const tenant = await requirePermission('settings.manage');
  const name = String(formData.get('name') || '').trim();
  const primaryColor = String(formData.get('primaryColor') || '#2563eb').trim();
  const currency = String(formData.get('currency') || 'BDT').trim().toUpperCase();
  const address = String(formData.get('address') || '').trim();
  const logoUrl = String(formData.get('logoUrl') || '').trim();

  if (logoUrl && !/^(https?:\/\/\S+|data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+)$/i.test(logoUrl)) return;

  if (!name) return;
  if (name.length > 120) return;
  if (!/^#[0-9A-Fa-f]{6}$/.test(primaryColor)) return;
  if (!/^[A-Z]{3,5}$/.test(currency)) return;

  await updateBranding({
    organizationId: tenant.organizationId,
    name,
    primaryColor,
    currency,
    address: address.slice(0, 500),
    logoUrl,
  });
  revalidatePath('/', 'layout');
}

export async function toggleModuleAction(moduleKey: string, enable: boolean): Promise<void> {
  const tenant = await requirePermission('settings.manage');
  if (!(moduleKey in MODULE_REGISTRY)) return;
  await setModuleEnabled(tenant.organizationId, moduleKey, Boolean(enable));
  revalidatePath('/', 'layout');
}

import { guardedAction } from '@/core/auth/action';
import {
  updateCompanyProfile,
  updateOrganizationSettings,
  upsertTaxConfiguration,
  deleteTaxConfiguration,
  createFiscalYear,
  setCurrentFiscalYear,
  closeFiscalYear,
  reopenFiscalYear,
  upsertDocumentSequence,
} from '@/core/settings/management';

function bool(value: FormDataEntryValue | null): boolean {
  return value === 'on' || value === 'true' || value === '1';
}

function num(value: FormDataEntryValue | null, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function updateRegionalSettingsAction(formData: FormData): Promise<void> {
  await guardedAction({ permission: 'settings.manage', revalidate: '/settings', redirectTo: '/settings', successMessage: 'Regional settings saved.' }, async (tenant) => {
    await updateOrganizationSettings({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      values: {
        currencyCode: String(formData.get('currencyCode') || 'BDT').trim().toUpperCase(),
        currencySymbol: String(formData.get('currencySymbol') || '৳').trim().slice(0, 10),
        decimalPrecision: num(formData.get('decimalPrecision'), 2),
        currencyDisplayFormat: String(formData.get('currencyDisplayFormat') || 'SYMBOL_BEFORE'),
        timezone: String(formData.get('timezone') || 'Asia/Dhaka'),
        dateFormat: String(formData.get('dateFormat') || 'DD/MM/YYYY'),
        timeFormat: String(formData.get('timeFormat') || '24H'),
        fiscalYearStartMonth: num(formData.get('fiscalYearStartMonth'), 7),
        fiscalYearStartDay: num(formData.get('fiscalYearStartDay'), 1),
        weekStartsOn: num(formData.get('weekStartsOn'), 0),
        enforceSecurityNotifications: bool(formData.get('enforceSecurityNotifications')),
      },
    });
  });
}

export async function updateCompanyProfileAction(formData: FormData): Promise<void> {
  await guardedAction({ permission: 'settings.manage', revalidate: '/settings', redirectTo: '/settings', successMessage: 'Company profile saved.' }, async (tenant) => {
    await updateCompanyProfile({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      name: String(formData.get('name') || ''),
      address: String(formData.get('address') || ''),
      phone: String(formData.get('phone') || ''),
      email: String(formData.get('email') || ''),
      website: String(formData.get('website') || ''),
      taxId: String(formData.get('taxId') || ''),
      registrationNumber: String(formData.get('registrationNumber') || ''),
    });
  });
}

export async function saveTaxAction(formData: FormData): Promise<void> {
  await guardedAction({ permission: 'settings.manage', revalidate: '/settings', redirectTo: '/settings', successMessage: 'Tax configuration saved.' }, async (tenant) => {
    await upsertTaxConfiguration({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      id: String(formData.get('id') || '') || undefined,
      name: String(formData.get('name') || ''),
      code: String(formData.get('code') || ''),
      rate: String(formData.get('rate') || '0'),
      taxType: String(formData.get('taxType') || 'VAT'),
      isInclusive: bool(formData.get('isInclusive')),
      isActive: formData.has('isActive') ? bool(formData.get('isActive')) : true,
      effectiveFrom: String(formData.get('effectiveFrom') || '') || undefined,
      effectiveTo: String(formData.get('effectiveTo') || '') || undefined,
    });
  });
}

export async function deleteTaxAction(formData: FormData): Promise<void> {
  await guardedAction({ permission: 'settings.manage', revalidate: '/settings', redirectTo: '/settings', successMessage: 'Tax configuration deleted.' }, async (tenant) => {
    await deleteTaxConfiguration({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      id: String(formData.get('id') || ''),
    });
  });
}

export async function createFiscalYearAction(formData: FormData): Promise<void> {
  await guardedAction({ permission: 'settings.manage', revalidate: '/settings', redirectTo: '/settings', successMessage: 'Fiscal year created.' }, async (tenant) => {
    await createFiscalYear({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      name: String(formData.get('name') || ''),
      startDate: String(formData.get('startDate') || ''),
      endDate: String(formData.get('endDate') || ''),
      setCurrent: bool(formData.get('setCurrent')),
    });
  });
}

export async function setCurrentFiscalYearAction(formData: FormData): Promise<void> {
  await guardedAction({ permission: 'settings.manage', revalidate: '/settings', redirectTo: '/settings', successMessage: 'Current fiscal year updated.' }, async (tenant) => {
    await setCurrentFiscalYear({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      id: String(formData.get('id') || ''),
    });
  });
}

export async function closeFiscalYearAction(formData: FormData): Promise<void> {
  await guardedAction({ permission: 'settings.manage', revalidate: '/settings', redirectTo: '/settings', successMessage: 'Fiscal year closed.' }, async (tenant) => {
    await closeFiscalYear({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      id: String(formData.get('id') || ''),
    });
  });
}

export async function reopenFiscalYearAction(formData: FormData): Promise<void> {
  await guardedAction({ permission: 'settings.manage', revalidate: '/settings', redirectTo: '/settings', successMessage: 'Fiscal year reopened.' }, async (tenant) => {
    await reopenFiscalYear({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      id: String(formData.get('id') || ''),
    });
  });
}

export async function saveDocumentSequenceAction(formData: FormData): Promise<void> {
  await guardedAction({ permission: 'settings.manage', revalidate: '/settings', redirectTo: '/settings', successMessage: 'Document numbering saved.' }, async (tenant) => {
    await upsertDocumentSequence({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      documentType: String(formData.get('documentType') || ''),
      prefix: String(formData.get('prefix') || ''),
      suffix: String(formData.get('suffix') || ''),
      startingNumber: num(formData.get('startingNumber'), 1),
      padding: num(formData.get('padding'), 6),
      includeFiscalYear: bool(formData.get('includeFiscalYear')),
      includeDate: bool(formData.get('includeDate')),
      resetPolicy: String(formData.get('resetPolicy') || 'YEARLY'),
    });
  });
}
