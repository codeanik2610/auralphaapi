import 'express';

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        sub: string;
        sid?: string;
        email: string;
        role: string;
        tokenType: 'access';
      };
    }
  }
}

export {};
