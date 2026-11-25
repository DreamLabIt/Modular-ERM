import { requireModuleAccess } from '@/core/auth/module-guard';
import { createCustomerAction } from '@/modules/crm/actions';
import { listCustomers } from '@/modules/crm/model';

export default async function CrmCustomersPage() {
  const tenant = await requireModuleAccess('crm', 'crm.view');
  const customers = await listCustomers(tenant.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">CRM — Customers & Clients</h1>
        <p className="text-sm text-slate-500">Centralized client profiles, contacts, and account tiers.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <form action={createCustomerAction} className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <input name="name" placeholder="Client Name" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="company" placeholder="Company / Group" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="email" type="email" placeholder="Email" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="phone" placeholder="Phone" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <select name="status" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="ACTIVE">ACTIVE</option>
            <option value="VIP">VIP</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>
          <button type="submit" className="rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 px-4 py-2">
            Add Client
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3">Client Name</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Tier</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {customers.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
                <td className="px-4 py-3">{c.company || '-'}</td>
                <td className="px-4 py-3">{c.email || '-'}</td>
                <td className="px-4 py-3">{c.phone || '-'}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">{c.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
