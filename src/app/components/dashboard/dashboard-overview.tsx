"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FolderKanban,
  Handshake,
  Package,
  ShoppingCart,
  TrendingUp,
  Users,
  Wallet,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  type DashboardChartEntry,
  type DashboardData,
  type DashboardDoughnutChartProps,
  type DashboardOverviewProps,
  type DashboardPanelProps,
  type DashboardPeriodOption,
  type DashboardPeriod,
  type DashboardTrendPoint,
  PROJECT_TASK_STATUSES,
  PROJECT_TASK_STATUS_LABELS,
  type ProjectTaskStatus,
} from "@/core/types";

const money = (value: number, currency: string) =>
  `${currency} ${value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  })}`;

const compactMoney = (value: number, currency: string) =>
  `${currency} ${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)}`;

const chartTooltipStyle: React.CSSProperties = {
  backgroundColor: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "0.75rem",
  color: "var(--foreground)",
};

const dateLabel = (date: Date, period: DashboardPeriod) => {
  if (period === "day") {
    return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
  }

  if (period === "month") {
    return date.toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
    });
  }

  return date.getFullYear().toString();
};

const periodKey = (date: Date, period: DashboardPeriod) => {
  if (period === "day") {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }
  if (period === "month") {
    return `${date.getFullYear()}-${date.getMonth()}`;
  }
  return String(date.getFullYear());
};

function buildChartData(
  transactions: DashboardData["transactions"],
  revenueInvoices: DashboardData["revenueInvoices"],
  period: DashboardPeriod,
): DashboardTrendPoint[] {
  const now = new Date();
  const buckets = new Map<
    string,
    { label: string; income: number; expense: number; revenue: number }
  >();

  const bucketCount = period === "day" ? 14 : period === "month" ? 12 : 5;
  for (let index = bucketCount - 1; index >= 0; index--) {
    const date =
      period === "day"
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - index)
        : period === "month"
          ? new Date(now.getFullYear(), now.getMonth() - index, 1)
          : new Date(now.getFullYear() - index, 0, 1);

    buckets.set(periodKey(date, period), {
      label: dateLabel(date, period),
      income: 0,
      expense: 0,
      revenue: 0,
    });
  }

  transactions.forEach((transaction) => {
    const bucket = buckets.get(periodKey(new Date(transaction.date), period));
    if (!bucket) return;

    if (transaction.type === "INCOME") {
      bucket.income += transaction.amount;
    } else if (transaction.type === "EXPENSE") {
      bucket.expense += transaction.amount;
    }
  });

  revenueInvoices.forEach((invoice) => {
    const bucket = buckets.get(periodKey(new Date(invoice.date), period));
    if (bucket) bucket.revenue += invoice.amount;
  });

  return Array.from(buckets.values());
}

function DoughnutChart({
  data,
  formatValue,
  emptyMessage,
}: DashboardDoughnutChartProps) {
  const total = data.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <div>
      <div className="h-40 min-w-0">
        {total > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data.filter((entry) => entry.value > 0)}
                dataKey="value"
                nameKey="name"
                innerRadius="58%"
                outerRadius="82%"
                paddingAngle={3}
                stroke="var(--surface)"
              >
                {data
                  .filter((entry) => entry.value > 0)
                  .map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
              </Pie>
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(value, name) => {
                  const amount = Number(value);
                  const percentage = total
                    ? ((amount / total) * 100).toFixed(1)
                    : "0.0";
                  return [
                    `${formatValue(amount)} (${percentage}%)`,
                    String(name),
                  ];
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center rounded-lg bg-[var(--background)] px-4 text-center text-xs text-[var(--text-secondary)]">
            {emptyMessage}
          </div>
        )}
      </div>
      <div className="mt-3 space-y-2" aria-label="Chart legend">
        {data.map((entry) => {
          const percentage = total
            ? ((entry.value / total) * 100).toFixed(1)
            : "0.0";

          return (
            <div
              key={entry.name}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="flex min-w-0 items-center gap-2 text-[var(--text-secondary)]">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="truncate">{entry.name}</span>
              </span>
              <span className="shrink-0 font-medium text-[var(--foreground)]">
                {formatValue(entry.value)} · {percentage}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
  action,
}: DashboardPanelProps) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[var(--foreground)]">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {subtitle}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function DashboardOverview({
  data,
  userName,
  organizationName,
  currency,
  enabledModules,
}: DashboardOverviewProps) {
  const [period, setPeriod] = useState<DashboardPeriod>("month");

  const chartData = useMemo(
    () => buildChartData(data.transactions, data.revenueInvoices, period),
    [data.transactions, data.revenueInvoices, period],
  );

  const profit = data.totals.income - data.totals.expense;

  const taskCount = (status: ProjectTaskStatus) =>
    data.taskSummary.find((item) => item.status === status)?.count || 0;

  const invoiceCount = (status: string) =>
    data.invoiceSummary.find((item) => item.status === status)?.count || 0;

  const totalTasks = PROJECT_TASK_STATUSES.reduce(
    (sum, status) => sum + taskCount(status),
    0,
  );
  const completedTasks = taskCount("COMPLETED");
  const taskProgress = totalTasks
    ? Math.round((completedTasks / totalTasks) * 100)
    : 0;
  const taskStatusColors: Record<ProjectTaskStatus, string> = {
    TODO: "var(--status-todo)",
    IN_PROGRESS: "var(--status-in-progress)",
    REVIEW: "var(--status-review)",
    COMPLETED: "var(--status-completed)",
  };
  const financialBreakdown: DashboardChartEntry[] = [
    { name: "Income", value: data.totals.income, color: "var(--primary)" },
    { name: "Expenses", value: data.totals.expense, color: "var(--secondary)" },
  ];
  const taskDistribution: DashboardChartEntry[] = PROJECT_TASK_STATUSES.map(
    (status) => ({
      name: PROJECT_TASK_STATUS_LABELS[status],
      value: taskCount(status),
      color: taskStatusColors[status],
    }),
  );
  const hasTransactionData = chartData.some(
    (item) => item.income !== 0 || item.expense !== 0,
  );
  const hasRevenueData = chartData.some((item) => item.revenue !== 0);

  const cards = [
    {
      title: "Total Revenue",
      value: money(data.totals.income, currency),
      note: "Recorded income",
      icon: TrendingUp,
      module: "accounting",
    },
    {
      title: "Total Expenses",
      value: money(data.totals.expense, currency),
      note: "Recorded expenses",
      icon: Wallet,
      module: "accounting",
    },
    {
      title: "Net Profit / Loss",
      value: money(profit, currency),
      note: "Revenue minus expenses",
      icon: Banknote,
      module: "accounting",
    },
    {
      title: "Sales Invoices",
      value: money(data.totals.invoiceTotal, currency),
      note: `${invoiceCount("PAID")} paid invoices`,
      icon: ShoppingCart,
      module: "sales_purchase",
    },
    {
      title: "Active Employees",
      value: data.totals.employeeCount.toLocaleString(),
      note: `${data.presentToday} present today`,
      icon: Users,
      module: "hrm",
    },
    {
      title: "Total Clients",
      value: data.totals.customerCount.toLocaleString(),
      note: "Organization clients",
      icon: Handshake,
      module: "crm",
    },
    {
      title: "Active Projects",
      value: data.totals.projectCount.toLocaleString(),
      note: "Projects in workspace",
      icon: FolderKanban,
      module: "projects",
    },
    {
      title: "Inventory Products",
      value: data.totals.productCount.toLocaleString(),
      note: `${data.lowStockItems.length} low stock alerts`,
      icon: Package,
      module: "inventory",
    },
  ];

  const periodOptions: DashboardPeriodOption[] = [
    { label: "Day", value: "day" },
    { label: "Month", value: "month" },
    { label: "Year", value: "year" },
  ];
  const periodLabels: Record<DashboardPeriod, string> = {
    day: "Last 14 days",
    month: "Last 12 months",
    year: "Last 5 years",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
            Welcome Dashboard
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {organizationName} business overview {""} {"-"}{" "}
            <strong className="text-[var(--foreground)]">{userName}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2 self-start rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-secondary)] sm:self-auto">
          <CalendarDays className="h-4 w-4 text-[var(--primary)]" />
          {new Date().toLocaleDateString("en-US", {
            weekday: "short",
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          const enabled = enabledModules.includes(card.module);

          return (
            <div
              key={card.title}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  {card.title}
                </p>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--background)] text-[var(--primary)]">
                  <Icon className="h-5 w-5" />
                </span>
              </div>

              <p className="mt-4 break-words text-xl font-bold text-[var(--foreground)]">
                {enabled ? card.value : "Locked"}
              </p>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                {enabled ? card.note : "Module is not enabled"}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="min-w-0 space-y-5">
          <Panel
            title="Income vs Expense"
            subtitle={`Account transactions · ${periodLabels[period]}`}
            action={
              <div className="flex flex-wrap border border-[var(--border)] bg-[var(--background)] p-1">
                {periodOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPeriod(option.value)}
                    aria-pressed={period === option.value}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                      period === option.value
                        ? "bg-[var(--primary)] text-white shadow-sm"
                        : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            }
          >
            {hasTransactionData ? (
              <div className="h-72 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{ top: 8, right: 8, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid
                      stroke="var(--border)"
                      strokeDasharray="3 3"
                      vertical={false}
                    />

                    <XAxis
                      dataKey="label"
                      tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--border)" }}
                      minTickGap={20}
                    />

                    <YAxis
                      width={72}
                      tickFormatter={(value: number) =>
                        compactMoney(value, currency)
                      }
                      tick={{ fill: "var(--text-secondary)", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />

                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      cursor={{ fill: "var(--background)" }}
                      formatter={(value, name) => [
                        money(Number(value), currency),
                        String(name),
                      ]}
                    />

                    <Legend
                      wrapperStyle={{
                        color: "var(--text-secondary)",
                        fontSize: 16,
                      }}
                    />

                    <Bar
                      dataKey="income"
                      name="Income"
                      fill="var(--primary)"
                      radius={[4, 4, 0, 0]}
                    />

                    <Bar
                      dataKey="expense"
                      name="Expenses"
                      fill="var(--secondary)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="grid h-72 place-items-center rounded-lg bg-[var(--background)] px-4 text-center text-sm text-[var(--text-secondary)]">
                No income or expense transactions for this period.
              </div>
            )}
          </Panel>

          <Panel
            title="Revenue Trend"
            subtitle={`Paid invoices · ${periodLabels[period]}`}
          >
            {hasRevenueData ? (
              <div className="h-64 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData}
                    margin={{ top: 8, right: 8, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid
                      stroke="var(--border)"
                      strokeDasharray="3 3"
                      vertical={false}
                    />

                    <XAxis
                      dataKey="label"
                      tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--border)" }}
                      minTickGap={20}
                    />

                    <YAxis
                      width={72}
                      tickFormatter={(value: number) =>
                        compactMoney(value, currency)
                      }
                      tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />

                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      formatter={(value) => [
                        money(Number(value), currency),
                        "Revenue",
                      ]}
                    />

                    <Legend
                      wrapperStyle={{
                        color: "var(--text-secondary)",
                        fontSize: 12,
                      }}
                    />

                    <Line
                      type="monotone"
                      dataKey="revenue"
                      name="Revenue"
                      stroke="var(--primary)"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: "var(--primary)" }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="grid h-20 place-items-center rounded-lg bg-[var(--background)] px-4 text-center text-sm text-[var(--text-secondary)]">
                No paid invoice revenue for this period.
              </div>
            )}
          </Panel>
        </div>

        <Panel
          title="Business Snapshot"
          subtitle="Revenue, financial mix, and sales"
        >
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <section className="min-w-0 rounded-xl border border-[var(--border)] p-3">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">
                  Income &amp; Expense Breakdown
                </h3>

                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Organization-wide transaction totals
                </p>

                <div className="mt-3 min-w-0">
                  <DoughnutChart
                    data={financialBreakdown}
                    formatValue={(value) => money(value, currency)}
                    emptyMessage="No income or expense data yet."
                  />
                </div>
              </section>

              <section className="min-w-0 rounded-xl border border-[var(--border)] p-3">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">
                  Project Task Distribution
                </h3>

                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Tasks across all organization projects
                </p>

                <div className="mt-3 min-w-0">
                  <DoughnutChart
                    data={taskDistribution}
                    formatValue={(value) => value.toLocaleString()}
                    emptyMessage="No project tasks yet."
                  />
                </div>
              </section>
            </div>

            <section className="border-t border-[var(--border)] pt-4">
              <h3 className="mb-3 text-sm font-semibold text-[var(--foreground)]">
                Business Summary
              </h3>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[
                  {
                    label: "Total Income",
                    value: money(data.totals.income, currency),
                  },
                  {
                    label: "Total Expenses",
                    value: money(data.totals.expense, currency),
                  },
                  {
                    label: "Net Profit / Loss",
                    value: money(profit, currency),
                  },
                  {
                    label: "Total Sales",
                    value: money(data.totals.invoiceTotal, currency),
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-[var(--background)] p-3"
                  >
                    <span className="text-xs text-[var(--text-secondary)]">
                      {item.label}
                    </span>

                    <strong
                      className={`break-words text-right text-xs ${
                        item.label === "Net Profit / Loss" && profit < 0
                          ? "text-red-600"
                          : "text-[var(--foreground)]"
                      }`}
                    >
                      {item.value}
                    </strong>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel title="Project Progress" subtitle="Task completion overview">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {PROJECT_TASK_STATUSES.map((status) => (
                <div
                  key={status}
                  className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: taskStatusColors[status] }}
                      aria-hidden="true"
                    />
                    <span className="truncate text-xs text-[var(--text-secondary)]">
                      {PROJECT_TASK_STATUS_LABELS[status]}
                    </span>
                  </div>
                  <p className="mt-1 text-lg font-bold text-[var(--foreground)]">
                    {taskCount(status)}
                  </p>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-[var(--text-secondary)]">
                  Overall completion
                </span>
                <strong className="text-[var(--foreground)]">
                  {taskProgress}%
                </strong>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-[var(--border)]"
                role="progressbar"
                aria-label="Completed tasks"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={taskProgress}
              >
                <div
                  className="h-full rounded-full bg-[var(--primary)] transition-[width]"
                  style={{ width: `${taskProgress}%` }}
                />
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                {completedTasks} of {totalTasks} tasks completed
              </p>
            </div>

            <div className="flex items-center justify-between border-t border-[var(--border)] pt-3 text-xs">
              <span className="text-[var(--text-secondary)]">Total tasks</span>
              <strong className="text-[var(--foreground)]">{totalTasks}</strong>
            </div>
          </div>
        </Panel>

        <Panel title="HR Overview" subtitle="Today's workforce snapshot">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--background)] text-[var(--primary)]">
                  <Users className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    Active Employees
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Registered active staff
                  </p>
                </div>
              </div>
              <strong className="text-lg text-[var(--foreground)]">
                {data.totals.employeeCount}
              </strong>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--background)] text-[var(--primary)]">
                  <Users className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    Manager Accounts
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Active users with the Manager role
                  </p>
                </div>
              </div>
              <strong className="text-lg text-[var(--foreground)]">
                {data.totals.managerCount}
              </strong>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--background)] text-[var(--primary)]">
                  <CheckCircle2 className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    Present Today
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Attendance records
                  </p>
                </div>
              </div>
              <strong className="text-lg text-[var(--foreground)]">
                {data.presentToday}
              </strong>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--background)] text-[var(--secondary)]">
                  <Clock3 className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    Pending Leave
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Awaiting approval
                  </p>
                </div>
              </div>
              <strong className="text-lg text-[var(--foreground)]">
                {data.pendingLeaves}
              </strong>
            </div>
          </div>
        </Panel>

        <Panel title="Sales & CRM" subtitle="Invoice and lead pipeline">
          <div className="space-y-4">
            {[
              { label: "Paid Invoices", value: invoiceCount("PAID") },
              { label: "Sent Invoices", value: invoiceCount("SENT") },
              { label: "Draft Invoices", value: invoiceCount("DRAFT") },
              {
                label: "Total Leads",
                value: data.leadSummary.reduce(
                  (sum, item) => sum + item.count,
                  0,
                ),
              },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-[var(--text-secondary)]">
                  {item.label}
                </span>
                <strong className="text-[var(--foreground)]">
                  {item.value}
                </strong>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Recent Invoices" subtitle="Latest sales invoice records">
          {data.recentInvoices.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[440px] text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
                    <th className="pb-3 font-semibold">Invoice</th>
                    <th className="pb-3 font-semibold">Customer</th>
                    <th className="pb-3 font-semibold">Amount</th>
                    <th className="pb-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentInvoices.map((invoice) => (
                    <tr
                      key={invoice.id}
                      className="border-b border-[var(--border)] last:border-0"
                    >
                      <td className="py-3 font-semibold text-[var(--foreground)]">
                        {invoice.invoiceNumber}
                      </td>
                      <td className="py-3 text-[var(--text-secondary)]">
                        {invoice.customer}
                      </td>
                      <td className="py-3 font-semibold text-[var(--foreground)]">
                        {money(invoice.amount, currency)}
                      </td>
                      <td className="py-3">
                        <span className="rounded-full bg-[var(--background)] px-2.5 py-1 font-semibold text-[var(--text-secondary)]">
                          {invoice.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-[var(--text-secondary)]">
              No invoice records found.
            </p>
          )}
        </Panel>

        <Panel title="Recent Projects" subtitle="Latest project activity">
          {data.projects.length ? (
            <div className="space-y-4">
              {data.projects.map((project) => (
                <div
                  key={project.id}
                  className="flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                      {project.name}
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {project.customer}
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      Budget: {money(project.budget, currency)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[var(--background)] px-2.5 py-1 text-[10px] font-semibold text-[var(--text-secondary)]">
                    {project.status.replaceAll("_", " ")}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-[var(--text-secondary)]">
              No project records found.
            </p>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel
          title="Low Stock Alerts"
          subtitle="Products at or below reorder level"
          action={
            <span className="rounded-full bg-[var(--background)] px-2.5 py-1 text-xs font-semibold text-[var(--text-secondary)]">
              {data.lowStockItems.length} items
            </span>
          }
        >
          {data.lowStockItems.length ? (
            <div className="space-y-3">
              {data.lowStockItems.slice(0, 5).map((item) => (
                <div
                  key={`${item.sku}-${item.warehouse}`}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--background)] text-[var(--secondary)]">
                      <AlertTriangle className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                        {item.productName}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {item.sku} · {item.warehouse}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-[var(--foreground)]">
                    {item.quantity} / {item.reorderLevel}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-[var(--text-secondary)]">
              No low stock products found.
            </p>
          )}
        </Panel>

        <Panel
          title="Recent Transactions"
          subtitle="Latest accounting activity"
          action={
            <span className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
              <Activity className="h-3.5 w-3.5" />
              Latest records
            </span>
          }
        >
          {data.transactions.length ? (
            <div className="space-y-3">
              {data.transactions.slice(0, 5).map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--background)] text-[var(--primary)]">
                      {transaction.type === "INCOME" ? (
                        <ArrowDownRight className="h-4 w-4" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                        {transaction.description}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {transaction.category} ·{" "}
                        {new Date(transaction.date).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-bold ${
                      transaction.type === "INCOME"
                        ? "text-[var(--primary)]"
                        : "text-[var(--text-secondary)]"
                    }`}
                  >
                    {transaction.type === "INCOME" ? "+" : "-"}
                    {money(transaction.amount, currency)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-[var(--text-secondary)]">
              No transaction records found.
            </p>
          )}
        </Panel>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-4 text-xs text-[var(--text-secondary)]">
        <span>{organizationName} · ERP Overview</span>
        <span className="flex items-center gap-1">
          <RefreshCw className="h-3 w-3" />
          Data loaded from your organization records
        </span>
      </div>
    </div>
  );
}
