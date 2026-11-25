import { requireModuleAccess } from '@/core/auth/module-guard';
import { createLeadAction } from '@/modules/crm/actions';
import { listLeads } from '@/modules/crm/model';

export default async function CrmLeadsPage() {
  const tenant = await requireModuleAccess('crm', 'crm.view');
  const leads = await listLeads(tenant.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">CRM — Leads & Deal Pipeline</h1>
        <p className="text-sm text-slate-500">Track prospective clients, deal values, and conversion stages.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <form action={createLeadAction} className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <input name="title" placeholder="Deal / Opportunity Title" required className="md:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="contactName" placeholder="Contact Person" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="estimatedValue" type="number" placeholder="Est. Value" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <select name="stage" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="NEW">NEW</option>
            <option value="QUALIFIED">QUALIFIED</option>
            <option value="PROPOSAL">PROPOSAL</option>
            <option value="WON">WON</option>
          </select>
          <button type="submit" className="rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 px-4 py-2">
            Add Lead
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3">Opportunity</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Value ({tenant.organization.currency})</th>
              <th className="px-4 py-3">Stage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {leads.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{l.title}</td>
                <td className="px-4 py-3">{l.contactName}</td>
                <td className="px-4 py-3 font-semibold">{Number(l.estimatedValue).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700">{l.stage}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
