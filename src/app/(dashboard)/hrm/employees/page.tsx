import { requireModuleAccess } from '@/core/auth/module-guard';
import { createEmployeeAction } from '@/modules/hrm/actions';
import { listEmployees } from '@/modules/hrm/model';

export default async function HrmEmployeesPage() {
  const tenant = await requireModuleAccess('hrm', 'hrm.view');
  const employees = await listEmployees(tenant.organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">HR Management — Employees</h1>
        <p className="text-sm text-slate-500">Manage staff profiles, departments, and base salary.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <form action={createEmployeeAction} className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <input name="employeeCode" placeholder="Code (EMP-102)" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="fullName" placeholder="Full Name" required className="md:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="designation" placeholder="Designation" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="department" placeholder="Department" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <input name="basicSalary" type="number" placeholder="Salary" required className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit" className="flex-1 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 px-3">Add</button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Designation</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Basic Salary ({tenant.organization.currency})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {employees.map((emp) => (
              <tr key={emp.id}>
                <td className="px-4 py-3 font-mono text-xs">{emp.employeeCode}</td>
                <td className="px-4 py-3 font-medium text-slate-900">{emp.fullName}</td>
                <td className="px-4 py-3">{emp.designation}</td>
                <td className="px-4 py-3">{emp.department}</td>
                <td className="px-4 py-3 font-semibold">{Number(emp.basicSalary).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
