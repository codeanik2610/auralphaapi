export interface LoginBody {
  email?: string;
  password?: string;
}

export interface RefreshBody {
  refreshToken?: string;
}

export interface LogoutBody {
  refreshToken?: string;
}

export interface AuthUserResponse {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
}

export interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUserResponse;
}

export interface AuthSessionResponse {
  id: string;
  isCurrent: boolean;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface LogoutAllSessionsResponse {
  revoked: true;
  count: number;
}
