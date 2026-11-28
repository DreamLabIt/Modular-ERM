import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getRequiredTenantSession } from '@/core/auth/session';
import { pageMessage } from '@/core/auth/action';
import { ActionMessage, StatusBadge } from '@/core/ui/ActionMessage';
import { IMPORT_DEFINITIONS } from '@/core/data/import-definitions';
import { EXPORT_DEFINITIONS } from '@/core/data/export';
import { listImportJobs, getImportJob } from '@/core/data/import-service';
import { listExportJobs } from '@/core/data/export';
import { getBackupPolicy, listBackups, restoreInstructions } from '@/core/data/backup';
import { listArchivedRecords } from '@/core/data/archive';
import { listRetentionPolicies, listRetentionRuns, RETENTION_DATA_TYPES } from '@/core/data/retention';
import { can } from '@/core/auth/authorization';
import {
  previewImportAction,
  executeImportAction,
  cancelImportAction,
  createExportAction,
  deleteExportAction,
  createBackupAction,
  verifyBackupAction,
  deleteBackupAction,
  archiveRecordAction,
  restoreRecordAction,
  saveRetentionPolicyAction,
  runRetentionAction,
} from './actions';

export const dynamic = 'force-dynamic';

export default async function DataManagementPage({
  searchParams = {},
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const tenant = await getRequiredTenantSession();
  if (!can(tenant, 'data.export') && !can(tenant, 'data.import')) {
    redirect('/dashboard?error=unauthorized');
  }
  const message = pageMessage(searchParams);
  const canImport = can(tenant, 'data.import');
  const canBackup = can(tenant, 'data.backup.manage') && getBackupPolicy().allowedEmails.includes(tenant.email.toLowerCase());
  const canArchive = can(tenant, 'data.archive.manage');
  const canRetention = can(tenant, 'data.retention.manage');

  const [importJobs, exportJobs, archivedRecords, policies, runs] = await Promise.all([
    listImportJobs(tenant.organizationId),
    listExportJobs(tenant.organizationId),
    listArchivedRecords(tenant.organizationId),
    listRetentionPolicies(tenant.organizationId),
    listRetentionRuns(tenant.organizationId),
  ]);
  const backups = canBackup ? await listBackups(tenant.email) : [];

  const detailId = typeof searchParams.importJob === 'string' ? searchParams.importJob : '';
  const selectedImport = detailId ? await getImportJob(tenant.organizationId, detailId).catch(() => null) : null;
  const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  const labelClass = 'block text-xs font-semibold text-slate-700';
  const thClass = 'py-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500';

  return (
    <div className="max-w-7xl space-y-8 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Data Management</h1>
          <p className="text-sm text-slate-500">
            Validated CSV/XLSX imports, CSV/XLSX/PDF exports, operator backups, archival and retention policies.
          </p>
        </div>
        <Link href="/settings" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">← Settings</Link>
      </div>

      <ActionMessage message={message} />

      {canImport && (
        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Import Data</h2>
          <form action={previewImportAction} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Resource</label>
              <select name="resourceType" className={inputClass}>
                {Object.entries(IMPORT_DEFINITIONS).map(([key, definition]) => (
                  <option key={key} value={key}>{definition.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>CSV or XLSX file (max 10 MB)</label>
              <input name="file" type="file" accept=".csv,.xlsx" required className={inputClass} />
            </div>
            <div className="flex items-end">
              <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Preview Import</button>
            </div>
          </form>
          <p className="mt-2 text-[11px] text-slate-500">
            Preview validates every row in a rolled-back transaction; nothing is written until you confirm.
          </p>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr>
                <th className={thClass}>File</th><th className={thClass}>Resource</th><th className={thClass}>Rows</th>
                <th className={thClass}>Created</th><th className={thClass}>Errors</th><th className={thClass}>Status</th><th />
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {importJobs.map((job) => (
                  <tr key={job.id}>
                    <td className="py-2 pr-3">{job.fileName}</td>
                    <td className="py-2 pr-3">{job.resourceType}</td>
                    <td className="py-2 pr-3">{job.successRows}/{job.totalRows}</td>
                    <td className="py-2 pr-3">{job.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
                    <td className="py-2 pr-3">{job.errorRows}</td>
                    <td className="py-2 pr-3"><StatusBadge status={job.status} /></td>
                    <td className="py-2 pr-3 flex gap-2">
                      <Link href={`/settings/data-management?importJob=${job.id}`} className="text-blue-600 hover:underline">Details</Link>
                      {job.status === 'PREVIEW' && (
                        <>
                          <form action={executeImportAction}>
                            <input type="hidden" name="jobId" value={job.id} />
                            <button type="submit" className="font-semibold text-emerald-700 hover:underline">Execute</button>
                          </form>
                          <form action={cancelImportAction}>
                            <input type="hidden" name="jobId" value={job.id} />
                            <button type="submit" className="text-red-600 hover:underline">Cancel</button>
                          </form>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {importJobs.length === 0 && <tr><td colSpan={7} className="py-4 text-slate-500">No imports yet.</td></tr>}
              </tbody>
            </table>
          </div>
          {selectedImport && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
              <div className="font-semibold text-slate-800">Preview details: {selectedImport.fileName}</div>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px]">
                {JSON.stringify({
                  mapping: selectedImport.mapping,
                  summary: selectedImport.status === 'PREVIEW' ? selectedImport.summary : null,
                  errors: selectedImport.errors,
                }, null, 2)}
              </pre>
            </div>
          )}
        </section>
      )}

      <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Export Data</h2>
        <form action={createExportAction} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Resource</label>
            <select name="resourceType" className={inputClass}>
              {Object.entries(EXPORT_DEFINITIONS).map(([key, definition]) => (
                <option key={key} value={key}>{definition.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Format</label>
            <select name="format" className={inputClass}><option>CSV</option><option>XLSX</option><option>PDF</option></select>
          </div>
          <div><label className={labelClass}>Status filter</label><input name="status" className={inputClass} /></div>
          <div><label className={labelClass}>From date</label><input name="from" type="date" className={inputClass} /></div>
          <div><label className={labelClass}>To date</label><input name="to" type="date" className={inputClass} /></div>
          <div><label className={labelClass}>Search</label><input name="search" className={inputClass} /></div>
          <div className="md:col-span-3"><button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Generate Export</button></div>
        </form>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr>
              <th className={thClass}>File</th><th className={thClass}>Format</th><th className={thClass}>Size</th>
              <th className={thClass}>Status</th><th className={thClass}>Expires</th><th />
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {exportJobs.map((job) => (
                <tr key={job.id}>
                  <td className="py-2 pr-3">{job.fileName}</td>
                  <td className="py-2 pr-3">{job.format}</td>
                  <td className="py-2 pr-3">{job.fileSize ? `${Math.ceil(job.fileSize / 1024)} KB` : '—'}</td>
                  <td className="py-2 pr-3"><StatusBadge status={job.status} /></td>
                  <td className="py-2 pr-3">{job.expiresAt?.toISOString().slice(0, 10) ?? '—'}</td>
                  <td className="py-2 pr-3 flex gap-2">
                    {job.status === 'COMPLETED' && job.downloadToken && (
                      <a className="font-semibold text-blue-600" href={`/api/exports/download?token=${job.downloadToken}`}>Download</a>
                    )}
                    {job.error && <span className="text-red-600">{job.error}</span>}
                    <form action={deleteExportAction}>
                      <input type="hidden" name="id" value={job.id} />
                      <button type="submit" className="text-red-600 hover:underline">Delete</button>
                    </form>
                  </td>
                </tr>
              ))}
              {exportJobs.length === 0 && <tr><td colSpan={6} className="py-4 text-slate-500">No exports yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Backup & Restore</h2>
        <p className="text-xs text-slate-500 mb-4">
          Full logical PostgreSQL backups are restricted to platform operators listed in BACKUP_OPERATOR_EMAILS.
          Restore is a documented operator CLI procedure, not a dashboard button.
        </p>
        {canBackup ? (
          <>
            <form action={createBackupAction} className="flex flex-wrap gap-2 mb-4">
              <input name="reason" placeholder="Reason (optional)" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs" />
              <button type="submit" className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white">Create Backup</button>
            </form>
            <div className="mb-4 rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600">
              <div className="font-semibold text-slate-800">Restore procedure</div>
              <ol className="mt-1 list-decimal pl-5">{restoreInstructions('<backup-id>').map((line) => <li key={line}>{line}</li>)}</ol>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr>
                  <th className={thClass}>File</th><th className={thClass}>Size</th><th className={thClass}>Checksum</th>
                  <th className={thClass}>Status</th><th />
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {backups.map((backup) => (
                    <tr key={backup.id}>
                      <td className="py-2 pr-3">{backup.fileName}</td>
                      <td className="py-2 pr-3">{backup.fileSize ? `${Math.ceil(Number(backup.fileSize) / 1024)} KB` : '—'}</td>
                      <td className="py-2 pr-3 font-mono text-[10px]">{backup.checksum?.slice(0, 16) ?? '—'}</td>
                      <td className="py-2 pr-3"><StatusBadge status={backup.status} /></td>
                      <td className="py-2 pr-3 flex gap-2">
                        {backup.status === 'COMPLETED' && (
                          <form action={verifyBackupAction}>
                            <input type="hidden" name="id" value={backup.id} />
                            <button type="submit" className="font-semibold text-blue-600 hover:underline">Verify</button>
                          </form>
                        )}
                        <form action={deleteBackupAction}>
                          <input type="hidden" name="id" value={backup.id} />
                          <button type="submit" className="text-red-600 hover:underline">Delete</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                  {backups.length === 0 && <tr><td colSpan={5} className="py-4 text-slate-500">No backups found.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-600">
            Backup controls are hidden. Current policy: {getBackupPolicy().configured ? `${getBackupPolicy().allowedEmails.length} operator(s) configured` : 'no operators configured'}; schedule {getBackupPolicy().schedule}.
          </p>
        )}
      </section>

      {canArchive && (
        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Archive & Restore Records</h2>
          <form action={archiveRecordAction} className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
            <div>
              <label className={labelClass}>Resource Type</label>
              <select name="resourceType" className={inputClass}>
                <option>CUSTOMER</option><option>LEAD</option><option>PRODUCT</option><option>EMPLOYEE</option>
              </select>
            </div>
            <div><label className={labelClass}>Record ID</label><input name="resourceId" required className={inputClass} /></div>
            <div><label className={labelClass}>Reason</label><input name="reason" className={inputClass} /></div>
            <div className="flex items-end"><button type="submit" className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white">Archive</button></div>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr>
                <th className={thClass}>Resource</th><th className={thClass}>Record ID</th><th className={thClass}>Archived</th>
                <th className={thClass}>Reason</th><th className={thClass}>Status</th><th />
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {archivedRecords.map((record) => (
                  <tr key={record.id}>
                    <td className="py-2 pr-3">{record.resourceType}</td>
                    <td className="py-2 pr-3 font-mono text-[10px]">{record.resourceId}</td>
                    <td className="py-2 pr-3">{record.archivedAt.toISOString().slice(0, 10)}</td>
                    <td className="py-2 pr-3">{record.reason ?? '—'}</td>
                    <td className="py-2 pr-3"><StatusBadge status="ARCHIVED" /></td>
                    <td>
                      <form action={restoreRecordAction}>
                        <input type="hidden" name="id" value={record.id} />
                        <button type="submit" className="font-semibold text-blue-600 hover:underline">Restore</button>
                      </form>
                    </td>
                  </tr>
                ))}
                {archivedRecords.length === 0 && <tr><td colSpan={6} className="py-4 text-slate-500">No archived records.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {canRetention && (
        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Retention Policies</h2>
              <p className="text-xs text-slate-500">Legal hold completely skips a data type until it is removed.</p>
            </div>
            <form action={runRetentionAction}><button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700">Run policies now</button></form>
          </div>
          <div className="space-y-2">
            {policies.map((policy) => (
              <form key={policy.dataType} action={saveRetentionPolicyAction} className="grid grid-cols-2 md:grid-cols-6 gap-2 rounded-lg border border-slate-200 p-3 text-xs">
                <input type="hidden" name="dataType" value={policy.dataType} />
                <div className="col-span-2 font-semibold text-slate-800">{policy.dataType.replaceAll('_', ' ')}</div>
                <input name="retentionDays" type="number" min="30" max="3650" defaultValue={policy.retentionDays} className="rounded border border-slate-300 px-2 py-1" />
                <select name="action" defaultValue={policy.action} className="rounded border border-slate-300 px-2 py-1">
                  <option>DELETE</option><option>ANONYMIZE</option><option>ARCHIVE</option>
                </select>
                <label className="flex items-center gap-1"><input name="isActive" type="checkbox" defaultChecked={policy.isActive} className="h-3 w-3" />Active</label>
                <label className="flex items-center gap-1"><input name="legalHold" type="checkbox" defaultChecked={policy.legalHold} className="h-3 w-3" />Legal hold</label>
                <button type="submit" className="rounded bg-slate-800 px-2 py-1 text-[11px] font-semibold text-white">Save</button>
              </form>
            ))}
          </div>
          <div className="mt-5 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-2">Recent retention runs</h3>
            <div className="space-y-1 text-xs text-slate-600">
              {runs.slice(0, 10).map((run) => (
                <div key={run.id}>
                  {run.createdAt.toISOString().slice(0, 16).replace('T', ' ')} · {run.dataType} · deleted {run.deletedCount}, archived {run.archivedCount}, skipped {run.skippedCount}
                </div>
              ))}
              {runs.length === 0 && <p>No retention runs recorded.</p>}
            </div>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">Supported data types: {RETENTION_DATA_TYPES.join(', ')}</p>
        </section>
      )}
    </div>
  );
}
