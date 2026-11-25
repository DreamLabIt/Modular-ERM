import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_TRANSITIONS,
  calculateRemainingQuantity,
  isPurchaseOrderStatus,
  isValidPurchaseOrderTransition,
} from './workflow';

test('PURCHASE_ORDER_STATUSES covers every documented state', () => {
  assert.deepEqual(PURCHASE_ORDER_STATUSES, [
    'DRAFT',
    'PENDING_APPROVAL',
    'APPROVED',
    'SENT',
    'PARTIALLY_RECEIVED',
    'RECEIVED',
    'REJECTED',
    'CANCELLED',
  ]);
});

test('DRAFT can start the workflow or be cancelled', () => {
  assert.equal(isValidPurchaseOrderTransition('DRAFT', 'PENDING_APPROVAL'), true);
  assert.equal(isValidPurchaseOrderTransition('DRAFT', 'CANCELLED'), true);
  assert.equal(isValidPurchaseOrderTransition('DRAFT', 'APPROVED'), false);
  assert.equal(isValidPurchaseOrderTransition('DRAFT', 'RECEIVED'), false);
});

test('PENDING_APPROVAL flows into approval states or returns to draft', () => {
  assert.equal(isValidPurchaseOrderTransition('PENDING_APPROVAL', 'APPROVED'), true);
  assert.equal(isValidPurchaseOrderTransition('PENDING_APPROVAL', 'REJECTED'), true);
  assert.equal(isValidPurchaseOrderTransition('PENDING_APPROVAL', 'DRAFT'), true);
  assert.equal(isValidPurchaseOrderTransition('PENDING_APPROVAL', 'CANCELLED'), true);
  assert.equal(isValidPurchaseOrderTransition('PENDING_APPROVAL', 'SENT'), false);
});

test('APPROVED can be sent or cancelled', () => {
  assert.equal(isValidPurchaseOrderTransition('APPROVED', 'SENT'), true);
  assert.equal(isValidPurchaseOrderTransition('APPROVED', 'CANCELLED'), true);
  assert.equal(isValidPurchaseOrderTransition('APPROVED', 'RECEIVED'), true);
  assert.equal(isValidPurchaseOrderTransition('APPROVED', 'PENDING_APPROVAL'), false);
});

test('SENT can receive goods or be cancelled', () => {
  assert.equal(isValidPurchaseOrderTransition('SENT', 'PARTIALLY_RECEIVED'), true);
  assert.equal(isValidPurchaseOrderTransition('SENT', 'RECEIVED'), true);
  assert.equal(isValidPurchaseOrderTransition('SENT', 'CANCELLED'), true);
  assert.equal(isValidPurchaseOrderTransition('SENT', 'APPROVED'), false);
});

test('PARTIALLY_RECEIVED can keep receiving or complete the order', () => {
  assert.equal(isValidPurchaseOrderTransition('PARTIALLY_RECEIVED', 'PARTIALLY_RECEIVED'), true);
  assert.equal(isValidPurchaseOrderTransition('PARTIALLY_RECEIVED', 'RECEIVED'), true);
  assert.equal(isValidPurchaseOrderTransition('PARTIALLY_RECEIVED', 'CANCELLED'), false);
});

test('RECEIVED, REJECTED and CANCELLED are terminal', () => {
  for (const status of ['RECEIVED', 'REJECTED', 'CANCELLED'] as const) {
    assert.deepEqual(PURCHASE_ORDER_TRANSITIONS[status], []);
    assert.equal(isValidPurchaseOrderTransition(status, 'DRAFT'), false);
    assert.equal(isValidPurchaseOrderTransition(status, status), false);
  }
});

test('same-status transitions only allowed for PARTIALLY_RECEIVED', () => {
  for (const status of PURCHASE_ORDER_STATUSES) {
    const expected = status === 'PARTIALLY_RECEIVED';
    assert.equal(isValidPurchaseOrderTransition(status, status), expected);
  }
});

test('calculateRemainingQuantity is clamped at zero', () => {
  assert.equal(calculateRemainingQuantity(10, 0), 10);
  assert.equal(calculateRemainingQuantity(10, 3), 7);
  assert.equal(calculateRemainingQuantity(10, 10), 0);
  assert.equal(calculateRemainingQuantity(10, 15), 0);
});

test('isPurchaseOrderStatus validates raw values', () => {
  assert.equal(isPurchaseOrderStatus('DRAFT'), true);
  assert.equal(isPurchaseOrderStatus('dRAFT'), false);
  assert.equal(isPurchaseOrderStatus('RECEIVED '), false);
  assert.equal(isPurchaseOrderStatus('NOT_A_STATUS'), false);
});
