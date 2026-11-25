import { requireModuleAccess } from '@/core/auth/module-guard';
import { createLeaveRequestAction, updateLeaveStatusAction } from '@/modules/hrm/actions';
import { listActiveEmployees, listLeaveRequests } from '@/modules/hrm/model';

export default async function HrmLeavesPage() {
  const tenant = await requireModuleAccess('hrm', 'hrm.view');

  const [employees, leaves] = await Promise.all([
    listActiveEmployees(tenant.organizationId),
    listLeaveRequests(tenant.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">HR Management — Leave Requests</h1>
        <p className="text-sm text-slate-500">Submit and approve employee sick, casual, or annual leave.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <form action={createLeaveRequestAction} className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <select name="employeeId" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Select Employee</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.fullName}</option>
            ))}
          </select>
          <select name="leaveType" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="CASUAL">Casual Leave</option>
            <option value="SICK">Sick Leave</option>
            <option value="ANNUAL">Annual Leave</option>
          </select>
          <input name="startDate" type="date" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="endDate" type="date" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="days" type="number" min={1} defaultValue={1} placeholder="Days" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 px-4 py-2">
            Apply Leave
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3">Employee</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Days</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Approval</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {leaves.map((lv) => (
              <tr key={lv.id}>
                <td className="px-4 py-3 font-medium">{lv.employee.fullName}</td>
                <td className="px-4 py-3">{lv.leaveType}</td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {lv.startDate.toISOString().slice(0, 10)} to {lv.endDate.toISOString().slice(0, 10)}
                </td>
                <td className="px-4 py-3">{lv.days}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                    {lv.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-1">
                  {lv.status === 'PENDING' && (
                    <>
                      <form action={async () => { 'use server'; await updateLeaveStatusAction(lv.id, 'APPROVED'); }} className="inline">
                        <button className="px-2.5 py-1 rounded bg-emerald-600 text-white text-xs">Approve</button>
                      </form>
                      <form action={async () => { 'use server'; await updateLeaveStatusAction(lv.id, 'REJECTED'); }} className="inline">
                        <button className="px-2.5 py-1 rounded bg-red-600 text-white text-xs">Reject</button>
                      </form>
                    </>
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
