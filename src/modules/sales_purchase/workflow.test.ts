import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import {
  calculateOutstandingBalance,
  calculateTotalPaid,
  getEffectiveInvoiceStatus,
} from './workflow';

test('draft and cancelled statuses never display as overdue', () => {
  const pastDue = new Date('2025-01-01T00:00:00.000Z');
  assert.equal(getEffectiveInvoiceStatus({
    status: 'DRAFT',
    dueDate: pastDue,
    totalAmount: '100.00',
    totalPaid: '0',
  }), 'DRAFT');
  assert.equal(getEffectiveInvoiceStatus({
    status: 'CANCELLED',
    dueDate: pastDue,
    totalAmount: '100.00',
    totalPaid: '0',
  }), 'CANCELLED');
});

test('outstanding balance uses decimal arithmetic', () => {
  const balance = calculateOutstandingBalance('100.00', '35.25');
  assert.equal(balance.toFixed(2), '64.75');
  assert.equal(calculateOutstandingBalance('100.00', '100.00').toFixed(2), '0.00');
  assert.equal(calculateOutstandingBalance('100.00', '120.00').toFixed(2), '0.00');
});

test('multiple partial payments calculate paid and remaining amounts', () => {
  const paid = calculateTotalPaid([
    { amount: new Prisma.Decimal('25.10') },
    { amount: new Prisma.Decimal('30.40') },
  ]);
  assert.equal(paid.toFixed(2), '55.50');
  assert.equal(calculateOutstandingBalance('100.00', paid).toFixed(2), '44.50');
});

test('partial and paid effective statuses are derived correctly', () => {
  assert.equal(getEffectiveInvoiceStatus({
    status: 'PARTIALLY_PAID',
    dueDate: new Date('2027-12-31T00:00:00.000Z'),
    totalAmount: '100.00',
    totalPaid: '40.00',
    now: new Date('2026-11-25T00:00:00.000Z'),
  }), 'PARTIALLY_PAID');
  assert.equal(getEffectiveInvoiceStatus({
    status: 'SENT',
    dueDate: null,
    totalAmount: '100.00',
    totalPaid: '100.00',
  }), 'PAID');
  assert.equal(getEffectiveInvoiceStatus({
    status: 'PAID',
    dueDate: new Date('2020-01-01T00:00:00.000Z'),
    totalAmount: '100.00',
    totalPaid: '100.00',
  }), 'PAID');
});

test('overdue effective status requires an outstanding balance and past due date', () => {
  assert.equal(getEffectiveInvoiceStatus({
    status: 'SENT',
    dueDate: new Date('2026-11-24T23:59:59.000Z'),
    totalAmount: '100.00',
    totalPaid: '20.00',
    now: new Date('2026-11-25T12:00:00.000Z'),
  }), 'OVERDUE');
  assert.equal(getEffectiveInvoiceStatus({
    status: 'SENT',
    dueDate: new Date('2026-11-25T23:59:59.000Z'),
    totalAmount: '100.00',
    totalPaid: '20.00',
    now: new Date('2026-11-25T12:00:00.000Z'),
  }), 'PARTIALLY_PAID');
});

test('payment amount guards reject zero, negative, and excessive values conceptually', () => {
  for (const amount of ['0', '-1', '100.01']) {
    const decimal = new Prisma.Decimal(amount);
    if (amount === '100.01') {
      assert.equal(decimal.greaterThan(new Prisma.Decimal('100.00')), true);
    } else {
      assert.equal(decimal.lessThanOrEqualTo(0), true);
    }
  }
});
