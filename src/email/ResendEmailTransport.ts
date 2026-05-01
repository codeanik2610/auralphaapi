import { EmailDelivery } from '../database/entities/EmailDelivery';
import { env } from '../env';
import { EmailTransport } from './EmailTransport';

type ResendSendResponse = {
  id?: string;
  message?: string;
  name?: string;
  statusCode?: number;
};

export class ResendEmailTransport implements EmailTransport {
  private readonly baseUrl = env.email.resend.apiBaseUrl.replace(/\/+$/, '');

  validateConfiguration(): void {
    if (!env.email.enabled) {
      return;
    }

    if (!env.email.resend.apiKey) {
      throw new Error(
        'EMAIL_RESEND_API_KEY must be configured when EMAIL_PROVIDER=resend and EMAIL_DELIVERY_ENABLED=true'
      );
    }

    if (!env.email.resend.from) {
      throw new Error(
        'EMAIL_RESEND_FROM must be configured when EMAIL_PROVIDER=resend and EMAIL_DELIVERY_ENABLED=true'
      );
    }
  }

  async verify(): Promise<void> {
    this.validateConfiguration();
  }

  async send(delivery: EmailDelivery): Promise<void> {
    const response = await fetch(`${this.baseUrl}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.email.resend.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `email-delivery:${delivery.id}`,
      },
      body: JSON.stringify({
        from: env.email.resend.from,
        to: [delivery.recipientEmail],
        reply_to: env.email.resend.replyTo || undefined,
        subject: delivery.subject,
        text: delivery.body,
        headers: {
          'X-AurAlpha-Email-Delivery-Id': delivery.id,
          ...(delivery.alertId ? { 'X-AurAlpha-Alert-Id': delivery.alertId } : {}),
        },
        tags: [
          {
            name: 'channel',
            value: this.normalizeTagValue(delivery.channel),
          },
          {
            name: 'severity',
            value: this.normalizeTagValue(delivery.severity),
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await this.readErrorDetail(response);
      throw new Error(`Resend send failed: ${detail}`);
    }
  }

  private normalizeTagValue(value: string | null | undefined): string {
    const normalized = String(value || '')
      .trim()
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 256);

    return normalized || 'unknown';
  }

  private async readErrorDetail(response: Response): Promise<string> {
    try {
      const payload = (await response.json()) as ResendSendResponse;
      if (payload?.message) {
        return payload.message;
      }

      if (payload?.name && payload?.statusCode) {
        return `${payload.name} (${payload.statusCode})`;
      }

      if (payload?.name) {
        return payload.name;
      }
    } catch {
      // ignore JSON parse failures and fall back to response text
    }

    try {
      const text = await response.text();
      if (text.trim()) {
        return `${response.status} ${response.statusText}: ${text.trim()}`;
      }
    } catch {
      // ignore text read failures and fall back to status only
    }

    return `${response.status} ${response.statusText}`.trim();
  }
}
