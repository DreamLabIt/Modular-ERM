import { requireModuleAccess } from '@/core/auth/module-guard';
import { getReportData } from '@/modules/reports/model';

export default async function ReportsAnalyticsPage() {
  const tenant = await requireModuleAccess('reports', 'reports.view');
  const orgId = tenant.organizationId;
  const cur = tenant.organization.currency;

  const [
    invoices,
    purchases,
    transactions,
    products,
    employees,
    projects,
    leads,
  ] = await getReportData(orgId);

  const salesTotal = invoices.reduce((s, i) => s + Number(i.totalAmount), 0);
  const purchaseTotal = purchases.reduce((s, p) => s + Number(p.totalAmount), 0);
  const incomeTotal = transactions.filter((t) => t.type === 'INCOME').reduce((s, t) => s + Number(t.amount), 0);
  const expenseTotal = transactions.filter((t) => t.type === 'EXPENSE').reduce((s, t) => s + Number(t.amount), 0);
  const stockValuation = products.reduce((sum, p) => {
    const qty = p.stocks.reduce((a, b) => a + b.quantity, 0);
    return sum + qty * Number(p.costPrice);
  }, 0);
  const monthlyPayrollCommit = employees.reduce((s, e) => s + Number(e.basicSalary), 0);
  const pipelineValue = leads.reduce((s, l) => s + Number(l.estimatedValue), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Reports — Executive Business Analytics</h1>
        <p className="text-sm text-slate-500">Consolidated performance metrics across Finance, Sales, Inventory, CRM & HR.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900 mb-3">Financial Health</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Total Ledger Income</span><span className="font-semibold text-emerald-600">{cur} {incomeTotal.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Total Ledger Expense</span><span className="font-semibold text-red-600">{cur} {expenseTotal.toLocaleString()}</span></div>
            <div className="flex justify-between border-t pt-2"><span className="font-semibold">Net Profit</span><span className="font-bold text-blue-600">{cur} {(incomeTotal - expenseTotal).toLocaleString()}</span></div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900 mb-3">Commercial & Stock Valuation</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Total Invoiced Sales</span><span className="font-semibold">{cur} {salesTotal.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Total Procurement (PO)</span><span className="font-semibold">{cur} {purchaseTotal.toLocaleString()}</span></div>
            <div className="flex justify-between border-t pt-2"><span className="font-semibold">Warehouse Stock Cost Value</span><span className="font-bold text-slate-900">{cur} {stockValuation.toLocaleString()}</span></div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900 mb-3">HR, CRM & Projects Summary</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Monthly Base Payroll Commit</span><span className="font-semibold">{cur} {monthlyPayrollCommit.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">CRM Pipeline Value</span><span className="font-semibold text-indigo-600">{cur} {pipelineValue.toLocaleString()}</span></div>
            <div className="flex justify-between border-t pt-2"><span className="font-semibold">Active Projects</span><span className="font-bold">{projects.length}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
