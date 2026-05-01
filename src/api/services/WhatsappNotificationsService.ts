import { Inject, Service } from 'typedi';
import { AppSettingsRepository } from '../../database/repositories/AppSettingsRepository';
import { SuggestedTradeRepository } from '../../database/repositories/SuggestedTradeRepository';
import { WhatsappDeliveryRepository } from '../../database/repositories/WhatsappDeliveryRepository';
import { BrokerAccountRepository } from '../../database/repositories/BrokerAccountRepository';
import { Logger } from '../../lib/logger';
import { env } from '../../env';

const log = new Logger(__filename);
const LIVE_TRADE_SUGGESTION_TEMPLATE_KEY = 'live_trade_suggestion_ready_v1';
const LIVE_TRADE_SUGGESTION_SOURCE = 'trade-suggestion.live-auto';

export interface QueueLiveTradeSuggestionWhatsappPayload {
  userId: string;
  suggestedTradeId: string;
  automationId: string;
  automationRunId: string;
  automationName?: string | null;
  brokerKey?: string | null;
  accountId?: string | null;
  preTradeCheckId?: string | null;
}

export interface QueueLiveTradeSuggestionWhatsappResult {
  outcome: 'queued' | 'skipped';
  reason:
    | 'queued'
    | 'runtime-disabled'
    | 'provider-unconfigured'
    | 'missing-settings'
    | 'whatsapp-disabled'
    | 'missing-number'
    | 'unverified-number'
    | 'duplicate'
    | 'suggested-trade-missing';
  deliveryId?: string;
  dedupeKey?: string;
}

type SuggestedTradeSnapshot = {
  symbol?: string | null;
  timeframe?: string | null;
  side?: string | null;
  entryPrice?: string | null;
  stopLossPrice?: string | null;
  takeProfitTargets?: Array<number | string> | null;
};

@Service()
export class WhatsappNotificationsService {
  @Inject(() => AppSettingsRepository)
  private appSettingsRepository!: AppSettingsRepository;

  @Inject(() => SuggestedTradeRepository)
  private suggestedTradeRepository!: SuggestedTradeRepository;

  @Inject(() => WhatsappDeliveryRepository)
  private whatsappDeliveryRepository!: WhatsappDeliveryRepository;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  async queueLiveTradeSuggestionReadyNotification(
    payload: QueueLiveTradeSuggestionWhatsappPayload
  ): Promise<QueueLiveTradeSuggestionWhatsappResult> {
    if (!env.whatsapp.enabled) {
      return { outcome: 'skipped', reason: 'runtime-disabled' };
    }

    if (!this.isProviderConfigured()) {
      return { outcome: 'skipped', reason: 'provider-unconfigured' };
    }

    const userId = String(payload.userId || '').trim();
    const suggestedTradeId = String(payload.suggestedTradeId || '').trim();

    if (!userId || !suggestedTradeId) {
      return { outcome: 'skipped', reason: 'suggested-trade-missing' };
    }

    const settings = await this.appSettingsRepository.getSettings(userId);
    if (!settings) {
      return { outcome: 'skipped', reason: 'missing-settings' };
    }

    if (!settings.notifyWhatsapp || !settings.whatsappLiveTradeSuggestions) {
      return { outcome: 'skipped', reason: 'whatsapp-disabled' };
    }

    const recipientPhone = this.normalizeOptionalString(settings.whatsappNumber);
    if (!recipientPhone) {
      return { outcome: 'skipped', reason: 'missing-number' };
    }

    if (!settings.whatsappVerifiedAt) {
      return { outcome: 'skipped', reason: 'unverified-number' };
    }

    const dedupeKey = `live-suggestion:${userId}:${suggestedTradeId}:ready`;
    const existing = await this.whatsappDeliveryRepository.findByDedupeKey(dedupeKey);
    if (existing) {
      return {
        outcome: 'skipped',
        reason: 'duplicate',
        deliveryId: existing.id,
        dedupeKey,
      };
    }

    const suggestedTrade = await this.suggestedTradeRepository.getSuggestedTradeById(
      userId,
      suggestedTradeId
    );
    if (!suggestedTrade) {
      return { outcome: 'skipped', reason: 'suggested-trade-missing' };
    }

    const routeLabel = await this.resolveRouteLabel(
      userId,
      payload.brokerKey ?? null,
      payload.accountId ?? null
    );

    const delivery = await this.whatsappDeliveryRepository.queueDelivery({
      userId,
      suggestedTradeId,
      automationId: this.normalizeOptionalString(payload.automationId),
      automationRunId: this.normalizeOptionalString(payload.automationRunId),
      recipientPhone,
      templateKey: LIVE_TRADE_SUGGESTION_TEMPLATE_KEY,
      body: this.buildLiveTradeSuggestionMessage(
        {
          symbol: suggestedTrade.symbol,
          timeframe: suggestedTrade.timeframe,
          side: suggestedTrade.side,
          entryPrice: suggestedTrade.entryPrice,
          stopLossPrice: suggestedTrade.stopLossPrice,
          takeProfitTargets: suggestedTrade.takeProfitTargets,
        },
        {
          automationName: this.normalizeOptionalString(payload.automationName),
          routeLabel,
        }
      ),
      severity: 'high',
      route: routeLabel,
      source: LIVE_TRADE_SUGGESTION_SOURCE,
      dedupeKey,
    });

    log.info(
      `Queued WhatsApp live trade suggestion notification ${delivery.id} for suggested trade ${suggestedTradeId}`
    );

    return {
      outcome: 'queued',
      reason: 'queued',
      deliveryId: delivery.id,
      dedupeKey,
    };
  }

  private isProviderConfigured(): boolean {
    if (env.whatsapp.provider === 'twilio') {
      return Boolean(
        this.normalizeOptionalString(env.whatsapp.twilio.accountSid) &&
          this.normalizeOptionalString(env.whatsapp.twilio.authToken) &&
          this.normalizeOptionalString(env.whatsapp.twilio.from)
      );
    }

    return false;
  }

  private buildLiveTradeSuggestionMessage(
    suggestedTrade: SuggestedTradeSnapshot,
    context: {
      automationName: string | null;
      routeLabel: string | null;
    }
  ): string {
    const symbol = this.normalizeOptionalString(suggestedTrade.symbol) ?? 'Unknown symbol';
    const timeframe = this.normalizeOptionalString(suggestedTrade.timeframe) ?? 'Unknown timeframe';
    const side = this.formatSide(suggestedTrade.side);
    const entry = this.formatValue(suggestedTrade.entryPrice);
    const stopLoss = this.formatValue(suggestedTrade.stopLossPrice);
    const takeProfit = this.formatValue(
      this.pickFirstTakeProfitTarget(suggestedTrade.takeProfitTargets)
    );

    const lines = [
      'AurAlpha live trade suggestion',
      '',
      `${symbol} | ${timeframe} | ${side}`,
      `Entry: ${entry}`,
      `SL: ${stopLoss}`,
      `Target: ${takeProfit}`,
    ];

    if (context.routeLabel) {
      lines.push('', `Route: ${context.routeLabel}`);
    }

    if (context.automationName) {
      lines.push(`Automation: ${context.automationName}`);
    }

    lines.push('Status: Ready for live handling');

    return lines.join('\n');
  }

  private async resolveRouteLabel(
    userId: string,
    brokerKey: string | null,
    accountId: string | null
  ): Promise<string | null> {
    const normalizedBrokerKey = this.normalizeOptionalString(brokerKey);
    const normalizedAccountId = this.normalizeOptionalString(accountId);

    if (!normalizedBrokerKey && !normalizedAccountId) {
      return null;
    }

    if (normalizedAccountId) {
      const account = await this.brokerAccountRepository.getBrokerAccountById(
        userId,
        normalizedAccountId
      );
      const accountName =
        this.normalizeOptionalString(account?.accountName) ??
        this.normalizeOptionalString(account?.accountKey);
      const brokerLabel = this.normalizeOptionalString(account?.brokerKey, normalizedBrokerKey);

      if (brokerLabel && accountName) {
        return `${brokerLabel} / ${accountName}`;
      }
      if (accountName) {
        return accountName;
      }
    }

    return normalizedBrokerKey;
  }

  private pickFirstTakeProfitTarget(
    value: Array<number | string> | null | undefined
  ): number | string | null {
    if (!Array.isArray(value)) {
      return null;
    }

    for (const item of value) {
      if (item !== null && item !== undefined && String(item).trim()) {
        return item;
      }
    }

    return null;
  }

  private formatSide(value: string | null | undefined): string {
    const normalized = this.normalizeOptionalString(value)?.toUpperCase();
    if (normalized === 'BUY') {
      return 'Long';
    }
    if (normalized === 'SELL') {
      return 'Short';
    }
    return normalized ?? 'Unknown side';
  }

  private formatValue(value: unknown): string {
    const normalized = this.normalizeOptionalString(value);
    return normalized ?? '—';
  }

  private normalizeOptionalString(...values: Array<unknown>): string | null {
    for (const value of values) {
      if (value === undefined || value === null) {
        continue;
      }
      const normalized = String(value).trim();
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }
}
