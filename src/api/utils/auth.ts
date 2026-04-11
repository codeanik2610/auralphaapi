import { ForbiddenAppError, UnauthorizedAppError } from '../errors/AppError';

interface AuthUserLike {
  sub?: string;
  role?: string;
}

interface RequestWithAuthUser {
  authUser?: AuthUserLike;
  apiKeyAuthenticated?: boolean;
}

export function requireAuthUserId(request: unknown): string {
  const authUser = (request as RequestWithAuthUser | undefined)?.authUser;
  const userId = authUser?.sub;

  if (!userId) {
    throw new UnauthorizedAppError('Authentication required');
  }

  return userId;
}

export interface AuthUserContext {
  userId: string;
  role: string;
}

export function requireAuthUser(request: unknown): AuthUserContext {
  const authUser = (request as RequestWithAuthUser | undefined)?.authUser;
  const userId = authUser?.sub;
  const role = String(authUser?.role || '').trim();

  if (!userId) {
    throw new UnauthorizedAppError('Authentication required');
  }

  return {
    userId,
    role,
  };
}

export function requireAdminAuthUser(request: unknown): AuthUserContext {
  const context = requireAuthUser(request);
  if (context.role.toLowerCase() !== 'admin') {
    throw new ForbiddenAppError('Admin role is required');
  }
  return context;
}

export function requireAdminAuthUserOrApiKey(request: unknown): AuthUserContext | null {
  const requestContext = request as RequestWithAuthUser | undefined;
  if (requestContext?.apiKeyAuthenticated) {
    return null;
  }

  return requireAdminAuthUser(request);
}
