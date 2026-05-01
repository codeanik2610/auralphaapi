import { env } from '../env';
import { EmailTransport } from './EmailTransport';
import { ResendEmailTransport } from './ResendEmailTransport';
import { SmtpEmailTransport } from './SmtpEmailTransport';

export const createEmailTransport = (): EmailTransport => {
  switch (env.email.provider) {
    case 'smtp':
      return new SmtpEmailTransport();
    case 'resend':
      return new ResendEmailTransport();
    default:
      throw new Error(`Unsupported email provider: ${String(env.email.provider)}`);
  }
};
