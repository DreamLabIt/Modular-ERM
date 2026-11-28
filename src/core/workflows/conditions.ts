import { ValidationError } from '@/core/errors';

export const CONDITION_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'contains',
  'exists',
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export interface ConditionRule {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
}

export interface ConditionGroup {
  all?: ConditionNode[];
  any?: ConditionNode[];
  not?: ConditionNode;
}

export type ConditionNode = ConditionRule | ConditionGroup;

const FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function isGroup(node: ConditionNode): node is ConditionGroup {
  return (
    typeof node === 'object' &&
    node !== null &&
    ('all' in node || 'any' in node || 'not' in node)
  );
}

function isRule(node: ConditionNode): node is ConditionRule {
  return (
    typeof node === 'object' &&
    node !== null &&
    typeof (node as ConditionRule).field === 'string' &&
    typeof (node as ConditionRule).operator === 'string'
  );
}

export function validateConditionNode(node: unknown, depth = 0): ConditionNode {
  if (depth > 10) throw new ValidationError('Workflow condition is nested too deeply.');
  if (!node || typeof node !== 'object') {
    throw new ValidationError('Workflow condition must be an object.');
  }
  const record = node as Record<string, unknown>;
  if ('all' in record || 'any' in record) {
    const key = 'all' in record ? 'all' : 'any';
    const children = record[key];
    if (!Array.isArray(children) || children.length === 0 || children.length > 50) {
      throw new ValidationError(`Condition "${key}" must contain between 1 and 50 rules.`);
    }
    return {
      [key]: children.map((child) => validateConditionNode(child, depth + 1)),
    } as ConditionGroup;
  }
  if ('not' in record) {
    return { not: validateConditionNode(record.not, depth + 1) };
  }
  if (!isRule(node)) {
    throw new ValidationError('Condition rule requires a field and operator.');
  }
  if (!FIELD_PATTERN.test(node.field) || node.field.split('.').some((part) => part === '__proto__' || part === 'constructor' || part === 'prototype')) {
    throw new ValidationError('Condition field is invalid.');
  }
  if (!CONDITION_OPERATORS.includes(node.operator)) {
    throw new ValidationError('Condition operator is not supported.');
  }
  if (node.operator === 'in' || node.operator === 'not_in') {
    if (!Array.isArray(node.value)) {
      throw new ValidationError('The "in" operators require an array value.');
    }
  }
  return { field: node.field, operator: node.operator, value: node.value };
}

function readField(payload: Record<string, unknown>, field: string): unknown {
  let current: unknown = payload;
  for (const part of field.split('.')) {
    if (!current || typeof current !== 'object' || !(part in current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function compareNumeric(left: unknown, right: unknown): number | null {
  const a = typeof left === 'number' ? left : Number(left);
  const b = typeof right === 'number' ? right : Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a === b ? 0 : a < b ? -1 : 1;
}

export function evaluateConditionNode(
  node: ConditionNode,
  payload: Record<string, unknown>,
): boolean {
  if (isGroup(node)) {
    if (node.all) return node.all.every((child) => evaluateConditionNode(child, payload));
    if (node.any) return node.any.some((child) => evaluateConditionNode(child, payload));
    if (node.not) return !evaluateConditionNode(node.not, payload);
    return true;
  }

  const actual = readField(payload, node.field);
  switch (node.operator) {
    case 'exists':
      return actual !== undefined && actual !== null && actual !== '';
    case 'eq':
      return actual === node.value || String(actual) === String(node.value);
    case 'neq':
      return !(actual === node.value || String(actual) === String(node.value));
    case 'gt': {
      const result = compareNumeric(actual, node.value);
      return result !== null && result > 0;
    }
    case 'gte': {
      const result = compareNumeric(actual, node.value);
      return result !== null && result >= 0;
    }
    case 'lt': {
      const result = compareNumeric(actual, node.value);
      return result !== null && result < 0;
    }
    case 'lte': {
      const result = compareNumeric(actual, node.value);
      return result !== null && result <= 0;
    }
    case 'in':
      return Array.isArray(node.value) && node.value.some((value) => String(value) === String(actual));
    case 'not_in':
      return Array.isArray(node.value) && !node.value.some((value) => String(value) === String(actual));
    case 'contains':
      return typeof actual === 'string' && typeof node.value === 'string'
        ? actual.toLowerCase().includes(node.value.toLowerCase())
        : false;
    default:
      return false;
  }
}

/**
 * Evaluates a workflow condition tree. Conditions are data only; no JavaScript
 * or user-supplied code is ever executed.
 */
export function evaluateConditions(
  condition: unknown,
  payload: Record<string, unknown>,
): boolean {
  if (!condition) return true;
  try {
    return evaluateConditionNode(validateConditionNode(condition), payload);
  } catch {
    return false;
  }
}
