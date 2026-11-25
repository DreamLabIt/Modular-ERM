'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import {
  isProjectTaskStatus,
  PROJECT_TASK_STATUSES,
  PROJECT_TASK_STATUS_LABELS,
  type TaskStatusSelectProps,
  type ProjectTaskStatus,
} from '@/core/types';
import { updateTaskStatusAction } from './actions';

const STATUS_STYLES: Record<ProjectTaskStatus, string> = {
  TODO: 'border-slate-200 bg-slate-100 text-slate-700',
  IN_PROGRESS: 'border-blue-200 bg-blue-50 text-blue-700',
  REVIEW: 'border-amber-200 bg-amber-50 text-amber-800',
  COMPLETED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

export default function TaskStatusSelect({
  taskId,
  taskTitle,
  status,
}: TaskStatusSelectProps) {
  const [selectedStatus, setSelectedStatus] = useState<ProjectTaskStatus>(status);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSelectedStatus(status);
  }, [status]);

  async function handleStatusChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextStatus = event.currentTarget.value;
    if (!isProjectTaskStatus(nextStatus)) return;

    const previousStatus = selectedStatus;
    setSelectedStatus(nextStatus);
    setError('');
    setPending(true);

    try {
      const result = await updateTaskStatusAction(taskId, nextStatus);
      if (!result.success) {
        setSelectedStatus(previousStatus);
        setError(result.error);
      }
    } catch {
      setSelectedStatus(previousStatus);
      setError('Unable to save the task status. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-1 sm:items-end">
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`task-status-${taskId}`}>
          {taskTitle} status
        </label>
        <select
          id={`task-status-${taskId}`}
          aria-label={`${taskTitle} status`}
          aria-describedby={error ? `task-status-error-${taskId}` : undefined}
          value={selectedStatus}
          onChange={handleStatusChange}
          disabled={pending}
          className={`max-w-full rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors focus:border-[var(--focus-ring)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] disabled:cursor-wait disabled:opacity-60 ${STATUS_STYLES[selectedStatus]}`}
        >
          {PROJECT_TASK_STATUSES.map((taskStatus) => (
            <option key={taskStatus} value={taskStatus}>
              {PROJECT_TASK_STATUS_LABELS[taskStatus]}
            </option>
          ))}
        </select>
        {pending && (
          <span className="text-[11px] text-[var(--text-secondary)]" role="status">
            Saving...
          </span>
        )}
      </div>
      {error && (
        <p
          id={`task-status-error-${taskId}`}
          className="max-w-full break-words text-[11px] text-red-600"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
