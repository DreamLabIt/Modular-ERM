import { requireModuleAccess } from '@/core/auth/module-guard';
import { createCustomerAction } from '@/modules/sales/actions';
import { listCustomers } from '@/modules/sales/model';

export default async function SalesCustomersPage() {
  const tenant = await requireModuleAccess('sales', 'sales.view');

  const customers = await listCustomers(tenant.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Customers</h1>
        <p className="text-sm text-slate-500">Client directory for billing and invoicing.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Add New Customer</h2>
        <form action={createCustomerAction} className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input name="name" placeholder="Customer / Company Name" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="email" type="email" placeholder="Email" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="phone" placeholder="Phone" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="address" placeholder="Address" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 px-4 py-2">
            Add Customer
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Address</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {customers.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
                <td className="px-4 py-3 text-slate-600">{c.email || '-'}</td>
                <td className="px-4 py-3 text-slate-600">{c.phone || '-'}</td>
                <td className="px-4 py-3 text-slate-600">{c.address || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
