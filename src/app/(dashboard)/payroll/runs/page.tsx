import { requireModuleAccess } from '@/core/auth/module-guard';
import { generateMonthlyPayrollAction, markPayrollPaidAction } from '@/modules/payroll/actions';
import { listPayrolls } from '@/modules/payroll/model';

export default async function PayrollRunsPage() {
  const tenant = await requireModuleAccess('payroll', 'payroll.view');
  const payrolls = await listPayrolls(tenant.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Payroll — Salary, Bonus & Deductions</h1>
        <p className="text-sm text-slate-500">Generate monthly salary runs and record payouts.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <form action={generateMonthlyPayrollAction} className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input name="month" type="number" min={1} max={12} defaultValue={new Date().getMonth() + 1} placeholder="Month" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="year" type="number" defaultValue={new Date().getFullYear()} placeholder="Year" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="bonus" type="number" defaultValue={0} placeholder="Festival/Perf Bonus" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="deductions" type="number" defaultValue={0} placeholder="Tax/Late Deductions" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 px-4 py-2">
            Run Payroll
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3">Period</th>
              <th className="px-4 py-3">Employee</th>
              <th className="px-4 py-3">Basic</th>
              <th className="px-4 py-3">Bonus</th>
              <th className="px-4 py-3">Deductions</th>
              <th className="px-4 py-3">Net Pay ({tenant.organization.currency})</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {payrolls.map((pay) => (
              <tr key={pay.id}>
                <td className="px-4 py-3 font-medium">{pay.month}/{pay.year}</td>
                <td className="px-4 py-3">{pay.employee.fullName}</td>
                <td className="px-4 py-3">{Number(pay.basicSalary).toLocaleString()}</td>
                <td className="px-4 py-3 text-emerald-600">+{Number(pay.bonus).toLocaleString()}</td>
                <td className="px-4 py-3 text-red-600">-{Number(pay.deductions).toLocaleString()}</td>
                <td className="px-4 py-3 font-bold text-slate-900">{Number(pay.netSalary).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${pay.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                    {pay.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {pay.status !== 'PAID' && (
                    <form action={async () => { 'use server'; await markPayrollPaidAction(pay.id); }}>
                      <button className="px-3 py-1 rounded bg-slate-900 text-white text-xs font-medium hover:bg-slate-800">
                        Pay Now
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
