import nodemailer from 'nodemailer';
import { EmailDelivery } from '../database/entities/EmailDelivery';
import { env } from '../env';
import { EmailTransport } from './EmailTransport';

export class SmtpEmailTransport implements EmailTransport {
  private transporter = nodemailer.createTransport({
    host: env.email.smtp.host,
    port: env.email.smtp.port,
    secure: env.email.smtp.secure,
    auth:
      env.email.smtp.user || env.email.smtp.password
        ? {
            user: env.email.smtp.user || undefined,
            pass: env.email.smtp.password || undefined,
          }
        : undefined,
  });

  validateConfiguration(): void {
    if (!env.email.enabled) {
      return;
    }

    if (!env.email.smtp.host) {
      throw new Error('EMAIL_SMTP_HOST must be configured when EMAIL_DELIVERY_ENABLED is true');
    }

    if (!env.email.smtp.from) {
      throw new Error('EMAIL_SMTP_FROM must be configured when EMAIL_DELIVERY_ENABLED is true');
    }
  }

  async verify(): Promise<void> {
    this.validateConfiguration();
    await this.transporter.verify();
  }

  async send(delivery: EmailDelivery): Promise<void> {
    await this.transporter.sendMail({
      from: env.email.smtp.from,
      to: delivery.recipientEmail,
      replyTo: env.email.smtp.replyTo || undefined,
      subject: delivery.subject,
      text: delivery.body,
      headers: {
        'X-AurAlpha-Email-Delivery-Id': delivery.id,
        ...(delivery.alertId ? { 'X-AurAlpha-Alert-Id': delivery.alertId } : {}),
      },
    });
  }
}
