import { requireModuleAccess } from '@/core/auth/module-guard';
import { createProjectAction, createTaskAction } from '@/modules/projects/actions';
import { listAssignableEmployees, listCustomers, listProjects } from '@/modules/projects/model';
import TaskStatusSelect from '@/modules/projects/task-status-select';

export default async function ProjectsPage() {
  const tenant = await requireModuleAccess('projects', 'projects.view');

  const [projects, customers, employees] = await Promise.all([
    listProjects(tenant.organizationId),
    listCustomers(tenant.organizationId),
    listAssignableEmployees(tenant.organizationId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Project Management — Projects, Tasks & Deadlines</h1>
        <p className="text-sm text-slate-500">Track client deliverables, task assignments, and project deadlines.</p>
      </div>

      {/* Create Project & Task Forms */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">New Project</h2>
          <form action={createProjectAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input name="name" placeholder="Project Name" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <select name="customerId" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">Internal Project (No Client)</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input name="deadline" type="date" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <input name="budget" type="number" placeholder="Budget" className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <button type="submit" className="flex-1 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 px-3">
                Create
              </button>
            </div>
          </form>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Assign Project Task</h2>
          <form action={createTaskAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select name="projectId" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">Select Project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input name="title" placeholder="Task Title" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <select name="assigneeEmployeeId" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">Assign an employee (optional)</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.fullName}</option>
              ))}
            </select>
            <input name="assigneeName" placeholder="External assignee name (optional)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <input name="dueDate" type="date" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <button type="submit" className="flex-1 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 px-3">
                Add Task
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Projects & Tasks List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {projects.map((proj) => (
          <div key={proj.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-slate-900">{proj.name}</h3>
                <p className="text-xs text-slate-500">
                  Client: {proj.customer?.name || 'Internal'} • Deadline: {proj.deadline ? proj.deadline.toISOString().slice(0, 10) : 'Not set'}
                </p>
              </div>
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                {proj.status}
              </span>
            </div>

            <div className="divide-y divide-slate-100 border-t border-slate-100 pt-2">
              {proj.tasks.length === 0 && (
                <p className="text-xs text-slate-400 py-2">No tasks added yet.</p>
              )}
              {proj.tasks.map((t) => (
                <div key={t.id} className="py-2 flex flex-col gap-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className={t.status === 'COMPLETED' ? 'line-through text-slate-400 font-medium' : 'text-slate-800 font-medium'}>
                      {t.title}
                    </span>
                    <div className="text-[11px] text-slate-500">
                      Assignee: {t.assignee?.fullName || t.assigneeName || 'Unassigned'} {t.dueDate ? `• Due ${t.dueDate.toISOString().slice(0, 10)}` : ''}
                    </div>
                  </div>
                  <TaskStatusSelect taskId={t.id} taskTitle={t.title} status={t.status} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
