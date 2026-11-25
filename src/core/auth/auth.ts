import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { getUserPermissions } from '@/lib/permissions';
import { findUserAuthorization, findUserForCredentials } from './model';

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await findUserForCredentials(String(credentials.email));

        if (
          !user ||
          !user.isActive ||
          !user.role.isActive ||
          !user.organization.isActive ||
          user.role.organizationId !== user.organizationId
        ) {
          return null;
        }

        const valid = await bcrypt.compare(String(credentials.password), user.passwordHash);
        if (!valid) return null;

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
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (!session.user) return session;

      const userId = typeof token.id === 'string' ? token.id : '';
      const user = userId ? await findUserAuthorization(userId) : null;
      const isActive = Boolean(
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
});
