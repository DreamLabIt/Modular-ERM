import { prisma } from '@/core/db/prisma';

function isDebitNormal(type: string) {
  return type === 'ASSET' || type === 'EXPENSE';
}

export interface DateRangeFilter {
  fromDate?: Date;
  toDate?: Date;
}

export async function getGeneralLedger(
  organizationId: string,
  filters: DateRangeFilter & { accountId?: string },
) {
  const accounts = await prisma.account.findMany({
    where: {
      organizationId,
      ...(filters.accountId ? { id: filters.accountId } : {}),
    },
    orderBy: { code: 'asc' },
  });

  const allLines = await prisma.journalLine.findMany({
    where: {
      accountId: filters.accountId ? filters.accountId : { in: accounts.map((a) => a.id) },
      journalEntry: {
        organizationId,
        status: { in: ['POSTED', 'REVERSED'] },
        ...(filters.toDate ? { entryDate: { lte: filters.toDate } } : {}),
      },
    },
    include: {
      journalEntry: {
        select: {
          id: true,
          entryNumber: true,
          entryDate: true,
          description: true,
          reference: true,
          sourceType: true,
          status: true,
        },
      },
    },
    orderBy: [{ journalEntry: { entryDate: 'asc' } }, { id: 'asc' }],
  });

  const linesByAccount = new Map<string, typeof allLines>();
  for (const line of allLines) {
    const list = linesByAccount.get(line.accountId) ?? [];
    list.push(line);
    linesByAccount.set(line.accountId, list);
  }

  return accounts.map((acc) => {
    const debitNormal = isDebitNormal(acc.type);
    const lines = linesByAccount.get(acc.id) ?? [];
    let openingBalance = 0;
    let runningBalance = 0;
    const entries: Array<{
      id: string;
      entryNumber: string;
      entryDate: Date;
      description: string;
      reference: string | null;
      sourceType: string | null;
      debit: number;
      credit: number;
      runningBalance: number;
    }> = [];

    for (const line of lines) {
      const d = Number(line.debit);
      const c = Number(line.credit);
      const delta = debitNormal ? d - c : c - d;
      if (filters.fromDate && line.journalEntry.entryDate < filters.fromDate) {
        openingBalance += delta;
        runningBalance = openingBalance;
      } else {
        runningBalance += delta;
        entries.push({
          id: line.id,
          entryNumber: line.journalEntry.entryNumber,
          entryDate: line.journalEntry.entryDate,
          description: line.description || line.journalEntry.description,
          reference: line.journalEntry.reference,
          sourceType: line.journalEntry.sourceType,
          debit: d,
          credit: c,
          runningBalance,
        });
      }
    }

    return {
      account: acc,
      openingBalance,
      closingBalance: runningBalance,
      entries,
    };
  });
}

export async function getTrialBalance(organizationId: string, asOfDate?: Date) {
  const [accounts, grouped] = await Promise.all([
    prisma.account.findMany({ where: { organizationId }, orderBy: { code: 'asc' } }),
    prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        journalEntry: {
          organizationId,
          status: { in: ['POSTED', 'REVERSED'] },
          ...(asOfDate ? { entryDate: { lte: asOfDate } } : {}),
        },
      },
      _sum: { debit: true, credit: true },
    }),
  ]);

  const sumByAcc = new Map(
    grouped.map((g) => [
      g.accountId,
      { debit: Number(g._sum.debit ?? 0), credit: Number(g._sum.credit ?? 0) },
    ]),
  );

  let totalDebit = 0;
  let totalCredit = 0;

  const rows = accounts.map((acc) => {
    const sums = sumByAcc.get(acc.id) ?? { debit: 0, credit: 0 };
    const net = sums.debit - sums.credit;
    const netDebit = net > 0 ? net : 0;
    const netCredit = net < 0 ? Math.abs(net) : 0;
    totalDebit += netDebit;
    totalCredit += netCredit;
    return {
      accountId: acc.id,
      code: acc.code,
      name: acc.name,
      type: acc.type,
      periodDebit: sums.debit,
      periodCredit: sums.credit,
      debitBalance: netDebit,
      creditBalance: netCredit,
    };
  });

  return {
    rows,
    totalDebit: Math.round(totalDebit * 100) / 100,
    totalCredit: Math.round(totalCredit * 100) / 100,
    isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
  };
}

export async function getProfitAndLoss(organizationId: string, range: DateRangeFilter = {}) {
  const accounts = await prisma.account.findMany({
    where: { organizationId, type: { in: ['REVENUE', 'EXPENSE'] } },
    orderBy: { code: 'asc' },
  });

  const grouped = await prisma.journalLine.groupBy({
    by: ['accountId'],
    where: {
      accountId: { in: accounts.map((a) => a.id) },
      journalEntry: {
        organizationId,
        status: { in: ['POSTED', 'REVERSED'] },
        ...(range.fromDate || range.toDate
          ? {
              entryDate: {
                ...(range.fromDate ? { gte: range.fromDate } : {}),
                ...(range.toDate ? { lte: range.toDate } : {}),
              },
            }
          : {}),
      },
    },
    _sum: { debit: true, credit: true },
  });

  const map = new Map(
    grouped.map((g) => [g.accountId, { d: Number(g._sum.debit ?? 0), c: Number(g._sum.credit ?? 0) }]),
  );

  const revenueAccounts = accounts
    .filter((a) => a.type === 'REVENUE')
    .map((a) => {
      const s = map.get(a.id) ?? { d: 0, c: 0 };
      return { code: a.code, name: a.name, amount: s.c - s.d };
    });

  const expenseAccounts = accounts
    .filter((a) => a.type === 'EXPENSE')
    .map((a) => {
      const s = map.get(a.id) ?? { d: 0, c: 0 };
      return { code: a.code, name: a.name, amount: s.d - s.c };
    });

  const totalRevenue = revenueAccounts.reduce((s, r) => s + r.amount, 0);
  const totalExpenses = expenseAccounts.reduce((s, e) => s + e.amount, 0);
  const netProfit = totalRevenue - totalExpenses;

  return {
    revenueAccounts,
    expenseAccounts,
    totalRevenue,
    totalExpenses,
    netProfit,
  };
}

export async function getBalanceSheet(organizationId: string, asOfDate?: Date) {
  const [tb, pnl] = await Promise.all([
    getTrialBalance(organizationId, asOfDate),
    getProfitAndLoss(organizationId, asOfDate ? { toDate: asOfDate } : {}),
  ]);

  const assets = tb.rows
    .filter((r) => r.type === 'ASSET')
    .map((r) => ({ code: r.code, name: r.name, balance: r.debitBalance - r.creditBalance }));
  const liabilities = tb.rows
    .filter((r) => r.type === 'LIABILITY')
    .map((r) => ({ code: r.code, name: r.name, balance: r.creditBalance - r.debitBalance }));
  const equity = tb.rows
    .filter((r) => r.type === 'EQUITY')
    .map((r) => ({ code: r.code, name: r.name, balance: r.creditBalance - r.debitBalance }));

  const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
  const totalLiabilities = liabilities.reduce((s, l) => s + l.balance, 0);
  const totalEquity = equity.reduce((s, e) => s + e.balance, 0) + pnl.netProfit;

  return {
    assets,
    liabilities,
    equity,
    currentPeriodNetProfit: pnl.netProfit,
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
    isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
  };
}

export async function getCashFlowStatement(organizationId: string, range: DateRangeFilter = {}) {
  const cashAccounts = await prisma.account.findMany({
    where: { organizationId, code: { in: ['1000', '1010'] } },
    select: { id: true, code: true, name: true },
  });
  const cashIds = cashAccounts.map((a) => a.id);

  const lines = await prisma.journalLine.findMany({
    where: {
      accountId: { in: cashIds },
      journalEntry: {
        organizationId,
        status: { in: ['POSTED', 'REVERSED'] },
        ...(range.fromDate || range.toDate
          ? {
              entryDate: {
                ...(range.fromDate ? { gte: range.fromDate } : {}),
                ...(range.toDate ? { lte: range.toDate } : {}),
              },
            }
          : {}),
      },
    },
    include: {
      journalEntry: {
        select: { sourceType: true, entryDate: true, description: true, entryNumber: true },
      },
    },
  });

  let cashInflows = 0;
  let cashOutflows = 0;
  const bySource = new Map<string, { inflow: number; outflow: number }>();

  for (const line of lines) {
    const d = Number(line.debit);
    const c = Number(line.credit);
    cashInflows += d;
    cashOutflows += c;
    const src = line.journalEntry.sourceType ?? 'MANUAL';
    const current = bySource.get(src) ?? { inflow: 0, outflow: 0 };
    current.inflow += d;
    current.outflow += c;
    bySource.set(src, current);
  }

  return {
    cashInflows,
    cashOutflows,
    netCashFlow: cashInflows - cashOutflows,
    breakdown: Array.from(bySource.entries()).map(([source, vals]) => ({
      source,
      inflow: vals.inflow,
      outflow: vals.outflow,
      net: vals.inflow - vals.outflow,
    })),
  };
}

export async function getArApAging(organizationId: string) {
  const now = new Date();
  const [invoices, bills] = await Promise.all([
    prisma.invoice.findMany({
      where: { organizationId, status: { in: ['SENT', 'PARTIALLY_PAID'] } },
      include: { customer: true, payments: true },
    }),
    prisma.supplierBill.findMany({
      where: { organizationId, status: { in: ['POSTED', 'PARTIALLY_PAID'] } },
      include: { supplier: true },
    }),
  ]);

  const bucketFor = (dueDate: Date | null) => {
    if (!dueDate) return 'CURRENT';
    const days = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 0) return 'CURRENT';
    if (days <= 30) return '1_30';
    if (days <= 60) return '31_60';
    if (days <= 90) return '61_90';
    return 'OVER_90';
  };

  const arBuckets = { CURRENT: 0, '1_30': 0, '31_60': 0, '61_90': 0, OVER_90: 0 };
  const receivables = invoices.map((inv) => {
    const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
    const outstanding = Math.max(0, Number(inv.totalAmount) - paid);
    const bucket = bucketFor(inv.dueDate);
    arBuckets[bucket] += outstanding;
    return {
      id: inv.id,
      number: inv.invoiceNumber,
      party: inv.customer.name,
      dueDate: inv.dueDate,
      total: Number(inv.totalAmount),
      paid,
      outstanding,
      bucket,
    };
  });

  const apBuckets = { CURRENT: 0, '1_30': 0, '31_60': 0, '61_90': 0, OVER_90: 0 };
  const payables = bills.map((bill) => {
    const outstanding = Math.max(0, Number(bill.totalAmount) - Number(bill.paidAmount));
    const bucket = bucketFor(bill.dueDate);
    apBuckets[bucket] += outstanding;
    return {
      id: bill.id,
      number: bill.billNumber,
      party: bill.supplier.name,
      dueDate: bill.dueDate,
      total: Number(bill.totalAmount),
      paid: Number(bill.paidAmount),
      outstanding,
      bucket,
    };
  });

  return { arBuckets, receivables, apBuckets, payables };
}
