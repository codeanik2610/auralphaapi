import { BadRequestAppError } from '../errors/AppError';
import { LoginBody, LogoutBody, RefreshBody } from '../contracts/Auth';

export interface ValidatedLoginBody {
  email: string;
  password: string;
}

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

export const validateLoginBody = (body: LoginBody = {}): ValidatedLoginBody => {
  const email = normalizeEmail(body.email || '');
  const password = String(body.password || '');

  if (!email || !email.includes('@')) {
    throw new BadRequestAppError('A valid email is required');
  }

  if (!password) {
    throw new BadRequestAppError('Password is required');
  }

  return { email, password };
};

export const validateRefreshBody = (body: RefreshBody = {}): string => {
  const refreshToken = String(body.refreshToken || '').trim();
  if (!refreshToken) {
    throw new BadRequestAppError('refreshToken is required');
  }
  return refreshToken;
};

export const validateLogoutBody = (body: LogoutBody = {}): string => {
  const refreshToken = String(body.refreshToken || '').trim();
  if (!refreshToken) {
    throw new BadRequestAppError('refreshToken is required');
  }
  return refreshToken;
};
