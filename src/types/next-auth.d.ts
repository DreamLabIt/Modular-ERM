import type { DefaultSession } from 'next-auth';
import type {
  AuthTokenClaims,
  AuthUserFields,
  AuthenticatedSessionUser,
} from '@/core/types';

declare module 'next-auth' {
  interface User extends AuthUserFields {}

  interface Session {
    user: DefaultSession['user'] & AuthenticatedSessionUser;
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends AuthTokenClaims {}
}
