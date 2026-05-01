import { WhatsappDelivery } from '../database/entities/WhatsappDelivery';
import { env } from '../env';

export interface WhatsappTransportSendResult {
  providerMessageId?: string | null;
}

export class TwilioWhatsappTransport {
  validateConfiguration(): void {
    if (!env.whatsapp.enabled) {
      return;
    }

    if (env.whatsapp.provider !== 'twilio') {
      throw new Error(`Unsupported WhatsApp provider: ${env.whatsapp.provider}`);
    }

    if (!env.whatsapp.twilio.accountSid) {
      throw new Error(
        'WHATSAPP_TWILIO_ACCOUNT_SID must be configured when WHATSAPP_DELIVERY_ENABLED is true'
      );
    }

    if (!env.whatsapp.twilio.authToken) {
      throw new Error(
        'WHATSAPP_TWILIO_AUTH_TOKEN must be configured when WHATSAPP_DELIVERY_ENABLED is true'
      );
    }

    if (!env.whatsapp.twilio.from) {
      throw new Error(
        'WHATSAPP_TWILIO_FROM must be configured when WHATSAPP_DELIVERY_ENABLED is true'
      );
    }
  }

  async verify(): Promise<void> {
    this.validateConfiguration();
  }

  async send(delivery: WhatsappDelivery): Promise<WhatsappTransportSendResult> {
    this.validateConfiguration();

    const baseUrl = env.whatsapp.twilio.apiBaseUrl.replace(/\/+$/, '');
    const accountSid = env.whatsapp.twilio.accountSid;
    const authToken = env.whatsapp.twilio.authToken;
    const endpoint = `${baseUrl}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;

    const body = new URLSearchParams();
    body.set('From', this.formatWhatsappAddress(env.whatsapp.twilio.from));
    body.set('To', this.formatWhatsappAddress(delivery.recipientPhone));
    body.set('Body', delivery.body);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const rawBody = await response.text();
    let parsedBody: Record<string, unknown> | null = null;

    if (rawBody) {
      try {
        parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        parsedBody = null;
      }
    }

    if (!response.ok) {
      const providerMessage =
        this.readString(parsedBody?.message) ||
        this.readString(parsedBody?.detail) ||
        rawBody ||
        response.statusText ||
        'Unknown Twilio WhatsApp error';
      throw new Error(`Twilio WhatsApp send failed (${response.status}): ${providerMessage}`);
    }

    return {
      providerMessageId: this.readString(parsedBody?.sid) ?? null,
    };
  }

  private formatWhatsappAddress(value: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return normalized;
    }

    return normalized.toLowerCase().startsWith('whatsapp:') ? normalized : `whatsapp:${normalized}`;
  }

  private readString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized ? normalized : null;
  }
}
