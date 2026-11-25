import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '@/core/db/prisma';
import type {
  ManagedRole,
  ManagedUser,
  PermissionContext,
} from '@/core/types';
import { ROLES } from '@/core/types';
import {
  canDelegatePermissions,
  canDelegateRolePermissionChanges,
} from '@/lib/permissions';

interface CreateRoleInput {
  organizationId: string;
  actorUserId: string;
  actorAuthorization: PermissionContext;
  name: string;
  permissions: string[];
}

interface UpdateRoleInput extends CreateRoleInput {
  roleId: string;
}

interface CreateUserInput {
  organizationId: string;
  actorUserId: string;
  actorAuthorization: PermissionContext;
  roleId: string;
  name: string;
  email: string;
  password: string;
}

interface UpdateUserRoleInput {
  organizationId: string;
  actorUserId: string;
  actorAuthorization: PermissionContext;
  userId: string;
  roleId: string;
}

const isUniqueConstraintError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

const hasSamePermissions = (left: string[], right: string[]) => {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((permission, index) => permission === sortedRight[index])
  );
};

const isReservedRoleName = (name: string) =>
  Object.values(ROLES).some(
    (roleName) => roleName.toLowerCase() === name.toLowerCase(),
  );

export async function createRole(input: CreateRoleInput) {
  if (isReservedRoleName(input.name)) {
    return {
      success: false,
      error: 'This name is reserved for a system role.',
    } as const;
  }
  if (!canDelegatePermissions(input.actorAuthorization, input.permissions)) {
    return {
      success: false,
      error: 'You cannot grant permissions that you do not have.',
    } as const;
  }

  try {
    return await prisma.$transaction(async (transaction) => {
      const role = await transaction.role.create({
        data: {
          organizationId: input.organizationId,
          name: input.name,
          permissions: input.permissions,
        },
      });

      await transaction.securityAuditLog.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          targetType: 'ROLE',
          targetId: role.id,
          action: 'ROLE_CREATED',
          after: {
            name: role.name,
            permissions: role.permissions,
            isSystem: role.isSystem,
          },
        },
      });

      return { success: true } as const;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { success: false, error: 'A role with this name already exists.' } as const;
    }
    throw error;
  }
}

export async function updateRole(input: UpdateRoleInput) {
  try {
    return await prisma.$transaction(
      async (transaction) => {
        const role = await transaction.role.findFirst({
          where: { id: input.roleId, organizationId: input.organizationId },
        });
        if (!role) return { success: false, error: 'Role not found.' } as const;

        if (
          !canDelegateRolePermissionChanges(
            input.actorAuthorization,
            role.permissions,
            input.permissions,
          )
        ) {
          return {
            success: false,
            error: 'You cannot grant permissions that you do not have.',
          } as const;
        }

        if (role.isSystem && input.name !== role.name) {
          return {
            success: false,
            error: 'System role names cannot be changed.',
          } as const;
        }
        if (!role.isSystem && isReservedRoleName(input.name)) {
          return {
            success: false,
            error: 'This name is reserved for a system role.',
          } as const;
        }

        const nameChanged = role.name !== input.name;
        const permissionsChanged = !hasSamePermissions(
          role.permissions,
          input.permissions,
        );
        if (!nameChanged && !permissionsChanged) return { success: true } as const;

        const changed = await transaction.role.updateMany({
          where: {
            id: role.id,
            organizationId: input.organizationId,
            authorizationVersion: role.authorizationVersion,
            isActive: true,
          },
          data: {
            name: role.isSystem ? role.name : input.name,
            permissions: input.permissions,
            authorizationVersion: { increment: permissionsChanged ? 1 : 0 },
          },
        });
        if (changed.count !== 1) {
          return {
            success: false,
            error: 'The role changed during this update. Reload and try again.',
          } as const;
        }

        await transaction.securityAuditLog.create({
          data: {
            organizationId: input.organizationId,
            actorUserId: input.actorUserId,
            targetType: 'ROLE',
            targetId: role.id,
            action: 'ROLE_UPDATED',
            before: {
              name: role.name,
              permissions: role.permissions,
              authorizationVersion: role.authorizationVersion,
            },
            after: {
              name: role.isSystem ? role.name : input.name,
              permissions: input.permissions,
              authorizationVersion:
                role.authorizationVersion + (permissionsChanged ? 1 : 0),
            },
          },
        });

        return { success: true } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { success: false, error: 'A role with this name already exists.' } as const;
    }
    throw error;
  }
}

export async function setRoleActive(
  organizationId: string,
  actorUserId: string,
  roleId: string,
  isActive: boolean,
) {
  return prisma.$transaction(
    async (transaction) => {
      const role = await transaction.role.findFirst({
        where: { id: roleId, organizationId },
        include: { _count: { select: { users: true } } },
      });
      if (!role) return { success: false, error: 'Role not found.' } as const;
      if (role.isSystem) {
        return {
          success: false,
          error: 'System roles cannot be deactivated.',
        } as const;
      }
      if (!isActive && role._count.users > 0) {
        return {
          success: false,
          error: 'Reassign this role’s users before deactivating it.',
        } as const;
      }
      if (role.isActive === isActive) return { success: true } as const;

      const changed = await transaction.role.updateMany({
        where: {
          id: role.id,
          organizationId,
          authorizationVersion: role.authorizationVersion,
          isActive: role.isActive,
        },
        data: {
          isActive,
          authorizationVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        return {
          success: false,
          error: 'The role changed during this update. Reload and try again.',
        } as const;
      }

      await transaction.securityAuditLog.create({
        data: {
          organizationId,
          actorUserId,
          targetType: 'ROLE',
          targetId: role.id,
          action: isActive ? 'ROLE_ACTIVATED' : 'ROLE_DEACTIVATED',
          before: {
            isActive: role.isActive,
            authorizationVersion: role.authorizationVersion,
          },
          after: {
            isActive,
            authorizationVersion: role.authorizationVersion + 1,
          },
        },
      });
      return { success: true } as const;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function deleteRole(
  organizationId: string,
  actorUserId: string,
  roleId: string,
) {
  return prisma.$transaction(
    async (transaction) => {
      const role = await transaction.role.findFirst({
        where: { id: roleId, organizationId },
        include: { _count: { select: { users: true } } },
      });
      if (!role) return { success: false, error: 'Role not found.' } as const;
      if (role.isSystem) {
        return { success: false, error: 'System roles cannot be deleted.' } as const;
      }
      if (role._count.users > 0) {
        return {
          success: false,
          error: 'Reassign this role’s users before deleting it.',
        } as const;
      }

      await transaction.securityAuditLog.create({
        data: {
          organizationId,
          actorUserId,
          targetType: 'ROLE',
          targetId: role.id,
          action: 'ROLE_DELETED',
          before: {
            name: role.name,
            permissions: role.permissions,
            isActive: role.isActive,
            authorizationVersion: role.authorizationVersion,
          },
        },
      });
      await transaction.role.delete({ where: { id: role.id } });
      return { success: true } as const;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function createUser(input: CreateUserInput) {
  const passwordHash = await bcrypt.hash(input.password, 10);
  try {
    return await prisma.$transaction(async (transaction) => {
      const role = await transaction.role.findFirst({
        where: {
          id: input.roleId,
          organizationId: input.organizationId,
          isActive: true,
        },
      });
      if (!role) {
        return {
          success: false,
          error: 'Choose an active role in your organization.',
        } as const;
      }
      if (!canDelegatePermissions(input.actorAuthorization, role.permissions)) {
        return {
          success: false,
          error: 'You cannot assign a role with permissions you do not have.',
        } as const;
      }

      const user = await transaction.user.create({
        data: {
          organizationId: input.organizationId,
          roleId: input.roleId,
          name: input.name,
          email: input.email,
          passwordHash,
        },
        select: { id: true },
      });
      await transaction.securityAuditLog.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          targetType: 'USER',
          targetId: user.id,
          action: 'USER_ROLE_ASSIGNED',
          after: { roleId: role.id },
        },
      });
      return { success: true } as const;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { success: false, error: 'This email is already registered.' } as const;
    }
    throw error;
  }
}

export async function updateUserRole(input: UpdateUserRoleInput) {
  return prisma.$transaction(
    async (transaction) => {
      const [user, role] = await Promise.all([
        transaction.user.findFirst({
          where: { id: input.userId, organizationId: input.organizationId },
          include: { role: true },
        }),
        transaction.role.findFirst({
          where: {
            id: input.roleId,
            organizationId: input.organizationId,
            isActive: true,
          },
        }),
      ]);
      if (!user || !role) {
        return {
          success: false,
          error: 'User or active organization role not found.',
        } as const;
      }
      if (!canDelegatePermissions(input.actorAuthorization, role.permissions)) {
        return {
          success: false,
          error: 'You cannot assign a role with permissions you do not have.',
        } as const;
      }
      if (user.roleId === role.id) return { success: true } as const;

      await transaction.user.update({
        where: { id: user.id },
        data: { roleId: role.id },
      });
      await transaction.securityAuditLog.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          targetType: 'USER',
          targetId: user.id,
          action: 'USER_ROLE_CHANGED',
          before: { roleId: user.roleId, roleName: user.role.name },
          after: { roleId: role.id, roleName: role.name },
        },
      });
      return { success: true } as const;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function listUsersAndRoles(
  organizationId: string,
): Promise<[ManagedUser[], ManagedRole[]]> {
  const [users, roles] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        email: true,
        roleId: true,
        role: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.role.findMany({
      where: { organizationId },
      include: { _count: { select: { users: true } } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    }),
  ]);
  return [
    users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      roleId: user.roleId,
      roleName: user.role.name,
    })),
    roles.map((role) => ({
      id: role.id,
      name: role.name,
      permissions: role.permissions,
      isSystem: role.isSystem,
      isActive: role.isActive,
      authorizationVersion: role.authorizationVersion,
      userCount: role._count.users,
    })),
  ];
}
