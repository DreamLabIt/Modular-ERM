import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canDelegatePermissions,
  canDelegateRolePermissionChanges,
  getUserPermissions,
  hasPermission,
} from './permissions';
import { PERMISSION_KEYS, type PermissionContext } from '@/core/types';

const activeContext: PermissionContext = {
  permissions: [],
  userIsActive: true,
  roleIsActive: true,
  organizationIsActive: true,
};

test('grants permissions only when present in the database-provided context', () => {
  assert.equal(
    hasPermission(
      { ...activeContext, permissions: ['projects.view'] },
      'projects.view',
    ),
    true,
  );
  assert.equal(
    hasPermission({ ...activeContext, permissions: [] }, 'projects.view'),
    false,
  );
  assert.equal(
    hasPermission({ ...activeContext, permissions: ['*'] }, 'users_roles.manage'),
    true,
  );
  assert.equal(
    hasPermission({ ...activeContext, permissions: ['*'] }, 'unknown.manage'),
    false,
  );
});

test('filters invalid grants and denies inactive principals', () => {
  assert.deepEqual(
    getUserPermissions(
      ['projects.view', 'unknown.manage', 4, '*'],
      activeContext,
    ),
    ['projects.view', '*'],
  );

  for (const inactive of [
    { ...activeContext, userIsActive: false },
    { ...activeContext, roleIsActive: false },
    { ...activeContext, organizationIsActive: false },
  ]) {
    assert.deepEqual(getUserPermissions(['*'], inactive), []);
    assert.equal(hasPermission({ ...inactive, permissions: ['*'] }, 'projects.view'), false);
  }
});

test('permission delegation is limited to the actor grants', () => {
  assert.equal(
    canDelegatePermissions(
      { ...activeContext, permissions: ['projects.view'] },
      ['projects.view'],
    ),
    true,
  );
  assert.equal(
    canDelegatePermissions(
      { ...activeContext, permissions: ['projects.view'] },
      ['projects.view', 'users_roles.manage'],
    ),
    false,
  );
  assert.equal(
    canDelegatePermissions(
      { ...activeContext, permissions: ['*'] },
      ['projects.view', 'users_roles.manage'],
    ),
    true,
  );
  assert.equal(
    canDelegatePermissions(
      { ...activeContext, permissions: ['*'] },
      ['unknown.manage'],
    ),
    false,
  );
  assert.equal(
    canDelegatePermissions(
      { ...activeContext, permissions: [...PERMISSION_KEYS] },
      ['*'],
    ),
    true,
  );
});

test('role edits allow preserving or reducing existing grants but not adding unauthorized grants', () => {
  const actor = { ...activeContext, permissions: ['projects.view'] };
  assert.equal(
    canDelegateRolePermissionChanges(
      actor,
      ['projects.view', 'hrm.view'],
      ['projects.view'],
    ),
    true,
  );
  assert.equal(
    canDelegateRolePermissionChanges(
      actor,
      ['projects.view'],
      ['projects.view', 'users_roles.manage'],
    ),
    false,
  );
  assert.equal(
    canDelegateRolePermissionChanges(
      actor,
      ['*'],
      ['projects.view', 'hrm.view'],
    ),
    true,
  );
});
