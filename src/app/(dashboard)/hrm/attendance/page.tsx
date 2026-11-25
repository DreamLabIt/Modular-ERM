import { requireModuleAccess } from '@/core/auth/module-guard';
import { markAttendanceAction } from '@/modules/hrm/actions';
import { listAttendanceEmployees } from '@/modules/hrm/model';

export default async function HrmAttendancePage() {
  const tenant = await requireModuleAccess('hrm', 'hrm.view');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const employees = await listAttendanceEmployees(tenant.organizationId, today);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">HR Management — Daily Attendance</h1>
        <p className="text-sm text-slate-500">Attendance log for {today.toDateString()}</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3">Employee</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Mark</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {employees.map((emp) => {
              const rec = emp.attendances[0];
              return (
                <tr key={emp.id}>
                  <td className="px-4 py-3 font-medium">{emp.fullName} ({emp.employeeCode})</td>
                  <td className="px-4 py-3">{emp.department}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">
                      {rec ? rec.status : 'NOT MARKED'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-1">
                    {['PRESENT', 'LATE', 'ABSENT'].map((st) => (
                      <form
                        key={st}
                        action={async () => {
                          'use server';
                          await markAttendanceAction(emp.id, st);
                        }}
                        className="inline"
                      >
                        <button className="px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-100 text-xs font-medium">
                          {st}
                        </button>
                      </form>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
