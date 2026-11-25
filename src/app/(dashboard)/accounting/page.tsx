import { requireModuleAccess } from '@/core/auth/module-guard';
import { createTransactionAction } from '@/modules/accounting/actions';
import { listTransactions } from '@/modules/accounting/model';

export default async function AccountingPage() {
  const tenant = await requireModuleAccess('accounting', 'accounting.view');

  const transactions = await listTransactions(tenant.organizationId);

  const totalIncome = transactions
    .filter((t) => t.type === 'INCOME')
    .reduce((sum, t) => sum + Number(t.amount), 0);
  const totalExpense = transactions
    .filter((t) => t.type === 'EXPENSE')
    .reduce((sum, t) => sum + Number(t.amount), 0);
  const netProfit = totalIncome - totalExpense;
  const cur = tenant.organization.currency;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Accounting — Income, Expense & Profit/Loss</h1>
        <p className="text-sm text-slate-500">Real-time financial ledger and Profit & Loss statement.</p>
      </div>

      {/* P&L Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-500">Total Income</div>
          <div className="mt-2 text-2xl font-bold text-emerald-600">{cur} {totalIncome.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-500">Total Expenses</div>
          <div className="mt-2 text-2xl font-bold text-red-600">{cur} {totalExpense.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-500">Net Profit / Loss</div>
          <div className={`mt-2 text-2xl font-bold ${netProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
            {cur} {netProfit.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Add Ledger Entry */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <form action={createTransactionAction} className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <select name="type" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="INCOME">INCOME (+)</option>
            <option value="EXPENSE">EXPENSE (-)</option>
          </select>
          <input name="category" placeholder="Category (e.g. Sales, Rent)" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="description" placeholder="Description" required className="md:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="amount" type="number" step="0.01" placeholder="Amount" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 px-4 py-2">
            Record Entry
          </button>
        </form>
      </div>

      {/* Ledger Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3 text-right">Amount ({cur})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {transactions.map((tx) => (
              <tr key={tx.id}>
                <td className="px-4 py-3 text-xs text-slate-500">{tx.date.toISOString().slice(0, 10)}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${tx.type === 'INCOME' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {tx.type}
                  </span>
                </td>
                <td className="px-4 py-3 font-medium">{tx.category}</td>
                <td className="px-4 py-3 text-slate-600">{tx.description}</td>
                <td className={`px-4 py-3 text-right font-bold ${tx.type === 'INCOME' ? 'text-emerald-600' : 'text-red-600'}`}>
                  {tx.type === 'INCOME' ? '+' : '-'}{Number(tx.amount).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
