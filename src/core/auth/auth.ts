import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { getUserPermissions } from '@/lib/permissions';
import { findUserAuthorization, findUserForCredentials } from './model';
import { checkRateLimit } from '@/core/security/rate-limit';
import {
  createUserSession,
  revokeSessionByToken,
  touchSession,
  validateSessionToken,
} from '@/core/security/sessions';
import { getClientRequestInfo, recordLoginEvent } from '@/core/security/login-history';
import { recordAuditLog } from '@/core/audit';

function numberFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function safeLoginEvent(input: Parameters<typeof recordLoginEvent>[0]) {
  try {
    await recordLoginEvent(input);
  } catch (error) {
    console.error('[auth] failed to record login history', error);
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = String(credentials.email).trim().toLowerCase().slice(0, 254);
        const { ipAddress, userAgent } = getClientRequestInfo(request);

        const ipLimit = numberFromEnv('LOGIN_RATE_LIMIT_PER_IP', 20);
        const emailLimit = numberFromEnv('LOGIN_RATE_LIMIT_PER_EMAIL', 5);
        const windowSeconds = numberFromEnv('LOGIN_RATE_LIMIT_WINDOW_SECONDS', 300);

        const [ipResult, emailResult] = await Promise.all([
          checkRateLimit(`login:ip:${ipAddress ?? 'unknown'}`, {
            limit: ipLimit,
            windowSeconds,
          }),
          checkRateLimit(`login:email:${email}`, {
            limit: emailLimit,
            windowSeconds,
          }),
        ]);

        if (!ipResult.allowed || !emailResult.allowed) {
          await safeLoginEvent({
            email,
            status: 'BLOCKED',
            failureReason: 'RATE_LIMITED',
            ipAddress,
            userAgent,
          });
          return null;
        }

        const user = await findUserForCredentials(email);

        if (!user) {
          await safeLoginEvent({
            email,
            status: 'FAILED',
            failureReason: 'INVALID_CREDENTIALS',
            ipAddress,
            userAgent,
          });
          return null;
        }

        const failureReason = !user.isActive
          ? 'INACTIVE_USER'
          : !user.role.isActive
            ? 'INACTIVE_ROLE'
            : !user.organization.isActive
              ? 'INACTIVE_ORGANIZATION'
              : user.role.organizationId !== user.organizationId
                ? 'TENANT_MISMATCH'
                : null;

        if (failureReason) {
          await safeLoginEvent({
            organizationId: user.organizationId,
            userId: user.id,
            email,
            status: 'FAILED',
            failureReason,
            ipAddress,
            userAgent,
          });
          return null;
        }

        const valid = await bcrypt.compare(String(credentials.password), user.passwordHash);
        if (!valid) {
          await safeLoginEvent({
            organizationId: user.organizationId,
            userId: user.id,
            email,
            status: 'FAILED',
            failureReason: 'INVALID_CREDENTIALS',
            ipAddress,
            userAgent,
          });
          return null;
        }

        const session = await createUserSession({
          organizationId: user.organizationId,
          userId: user.id,
          ipAddress,
          userAgent,
        });

        await safeLoginEvent({
          organizationId: user.organizationId,
          userId: user.id,
          email,
          status: 'SUCCESS',
          ipAddress,
          userAgent,
        });

        await recordAuditLog({
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: 'LOGIN',
          resource: 'SESSION',
          resourceId: session.session.id,
          description: 'User signed in successfully.',
          ipAddress,
          userAgent,
        }).catch((error) => console.error('[auth] failed to record login audit', error));

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          organizationId: user.organizationId,
          roleName: user.role.name,
          roleId: user.roleId,
          authorizationVersion: user.role.authorizationVersion,
          userIsActive: user.isActive,
          roleIsActive: user.role.isActive,
          organizationIsActive: user.organization.isActive,
          permissions: getUserPermissions(user.role.permissions, {
            userIsActive: user.isActive,
            roleIsActive: user.role.isActive,
            organizationIsActive: user.organization.isActive,
          }),
          sessionTokenId: session.tokenId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.sessionTokenId = user.sessionTokenId;
        token.revoked = false;
      }

      if (!token.sessionTokenId) {
        token.revoked = true;
        token.revokedReason = 'NO_SESSION';
        return token;
      }

      const validation = await validateSessionToken(token.sessionTokenId as string);
      if (!validation.valid) {
        token.revoked = true;
        token.revokedReason = validation.reason;
        return token;
      }

      token.revoked = false;
      token.revokedReason = undefined;
      await touchSession(token.sessionTokenId as string);
      return token;
    },
    async session({ session, token }) {
      if (!session.user) return session;

      const userId = typeof token.id === 'string' ? token.id : '';
      const user = userId ? await findUserAuthorization(userId) : null;
      const sessionValid = !token.revoked;
      const isActive = Boolean(
        sessionValid &&
          user &&
          user.isActive &&
          user.role.isActive &&
          user.organization.isActive &&
          user.role.organizationId === user.organizationId,
      );

      if (!user || !isActive) {
        session.user.id = '';
        session.user.organizationId = '';
        session.user.roleId = '';
        session.user.roleName = '';
        session.user.permissions = [];
        session.user.authorizationVersion = -1;
        session.user.userIsActive = false;
        session.user.roleIsActive = false;
        session.user.organizationIsActive = false;
        return session;
      }

      session.user.id = user.id;
      session.user.organizationId = user.organizationId;
      session.user.roleId = user.roleId;
      session.user.roleName = user.role.name;
      session.user.authorizationVersion = user.role.authorizationVersion;
      session.user.userIsActive = user.isActive;
      session.user.roleIsActive = user.role.isActive;
      session.user.organizationIsActive = user.organization.isActive;
      session.user.permissions = getUserPermissions(user.role.permissions, {
        userIsActive: user.isActive,
        roleIsActive: user.role.isActive,
        organizationIsActive: user.organization.isActive,
      });
      session.user.name = user.name;
      session.user.email = user.email;
      return session;
    },
  },
  events: {
    async signOut(message) {
      const token =
        message && 'token' in message
          ? (message.token as { id?: string; sessionTokenId?: string } | null)
          : null;
      if (!token?.sessionTokenId) return;

      await revokeSessionByToken(token.sessionTokenId, 'LOGOUT', token.id).catch(() => undefined);

      if (token.id) {
        const user = await findUserAuthorization(token.id).catch(() => null);
        await safeLoginEvent({
          organizationId: user?.organizationId ?? null,
          userId: token.id,
          email: user?.email ?? '',
          status: 'LOGOUT',
        });
        await recordAuditLog({
          organizationId: user?.organizationId ?? null,
          actorUserId: token.id,
          action: 'LOGOUT',
          resource: 'SESSION',
          description: 'User signed out.',
        }).catch(() => undefined);
      }
    },
  },
});
