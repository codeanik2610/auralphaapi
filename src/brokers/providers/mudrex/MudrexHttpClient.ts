import { https } from 'follow-redirects';
import { Inject, Service } from 'typedi';
import {
  MudrexAsset,
  MudrexAssetDetail,
  MudrexCancelOrderResult,
  MudrexCreateOrderResult,
  MudrexFuturesFunds,
  MudrexLeveragePayload,
  MudrexOrder,
  MudrexPosition,
  MudrexPositionHistoryItem,
  MudrexPositionMarginUpdate,
  MudrexPositionRiskOrder,
  MudrexWalletFunds,
} from '../../../api';
import { BadRequestAppError } from '../../../api';
import { env } from '../../../env';
import { BrokerAccountRepository, BrokerRepository } from '../../../database';
import { decryptBrokerAccountSettings } from '../../../lib/brokerAccountSecrets';

const MUDREX_MAX_RETRIES = 2;

interface MudrexEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  errors?: Array<{
    code?: number;
    text?: string;
  }>;
}

export class MudrexConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MudrexConfigurationError';
  }
}

export class MudrexApiError extends Error {
  public readonly broker = 'mudrex';
  public readonly brokerStatusCode?: number;
  public readonly brokerRoutePath?: string;
  public readonly brokerErrorCode?: string;
  public readonly brokerErrorMessage?: string;
  public readonly brokerErrorPayload?: unknown;

  constructor(
    public statusCode: number,
    message: string,
    context?: {
      brokerStatusCode?: number;
      brokerRoutePath?: string;
      brokerErrorCode?: string;
      brokerErrorMessage?: string;
      brokerErrorPayload?: unknown;
    }
  ) {
    super(message);
    this.name = 'MudrexApiError';
    this.brokerStatusCode = context?.brokerStatusCode;
    this.brokerRoutePath = context?.brokerRoutePath;
    this.brokerErrorCode = context?.brokerErrorCode;
    this.brokerErrorMessage = context?.brokerErrorMessage ?? message;
    this.brokerErrorPayload = context?.brokerErrorPayload;
  }
}

interface MudrexParsedError {
  statusCode: number;
  message: string;
  code?: string;
  payload?: unknown;
  rawBody?: string;
}

interface MudrexCredentials {
  apiSecret: string;
  baseUrl: string;
}

interface RouteValidationRule {
  matches: (path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE') => boolean;
  isValid: (value: unknown) => boolean;
  message: string;
}

class MudrexRateLimiter {
  private readonly secondWindowMs = 1000;
  private readonly minuteWindowMs = 60_000;
  private readonly secondLimit = 2;
  private readonly minuteLimit = 50;
  private secondHits: number[] = [];
  private minuteHits: number[] = [];

  async acquire(): Promise<void> {
    while (true) {
      const now = Date.now();
      this.secondHits = this.secondHits.filter((hit) => now - hit < this.secondWindowMs);
      this.minuteHits = this.minuteHits.filter((hit) => now - hit < this.minuteWindowMs);

      if (this.secondHits.length < this.secondLimit && this.minuteHits.length < this.minuteLimit) {
        this.secondHits.push(now);
        this.minuteHits.push(now);
        return;
      }

      const secondDelay =
        this.secondHits.length >= this.secondLimit
          ? this.secondWindowMs - (now - this.secondHits[0])
          : 0;
      const minuteDelay =
        this.minuteHits.length >= this.minuteLimit
          ? this.minuteWindowMs - (now - this.minuteHits[0])
          : 0;

      const delay = Math.max(secondDelay, minuteDelay, 50);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

const mudrexRateLimiter = new MudrexRateLimiter();

const isMudrexAsset = (value: unknown): value is MudrexAsset => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const asset = value as Record<string, unknown>;
  return (
    typeof asset.id === 'string' &&
    typeof asset.name === 'string' &&
    typeof asset.symbol === 'string' &&
    typeof asset.min_contract === 'string' &&
    typeof asset.max_contract === 'string' &&
    typeof asset.quantity_step === 'string' &&
    typeof asset.min_price === 'string' &&
    typeof asset.max_price === 'string' &&
    typeof asset.price_step === 'string' &&
    typeof asset.max_market_contract === 'string' &&
    typeof asset.min_notional_value === 'string' &&
    typeof asset.funding_fee_perc === 'string' &&
    (asset.max_funding_rate === null || typeof asset.max_funding_rate === 'string') &&
    (asset.min_funding_rate === null || typeof asset.min_funding_rate === 'string') &&
    (asset.trading_fee_perc === undefined || typeof asset.trading_fee_perc === 'string') &&
    typeof asset.leverage_step === 'string' &&
    typeof asset.min_leverage === 'string' &&
    typeof asset.max_leverage === 'string' &&
    typeof asset.funding_interval === 'number' &&
    typeof asset.price === 'string' &&
    typeof asset.last_day_price === 'string' &&
    typeof asset.change_perc === 'string' &&
    typeof asset.volume === 'string' &&
    typeof asset.popularity === 'string'
  );
};

const isMudrexWalletFunds = (value: unknown): value is MudrexWalletFunds => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const funds = value as Record<string, unknown>;
  return (
    typeof funds.total === 'number' &&
    typeof funds.rewards === 'number' &&
    typeof funds.invested === 'number' &&
    typeof funds.withdrawable === 'number' &&
    typeof funds.coin_investable === 'number' &&
    typeof funds.coinset_investable === 'number' &&
    typeof funds.vault_investable === 'number'
  );
};

const isMudrexFuturesFunds = (value: unknown): value is MudrexFuturesFunds => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const funds = value as Record<string, unknown>;
  return (
    typeof funds.balance === 'string' &&
    typeof funds.locked_amount === 'string' &&
    typeof funds.first_time_user === 'boolean'
  );
};

const isMudrexAssetDetail = (value: unknown): value is MudrexAssetDetail => {
  if (!isMudrexAsset(value)) {
    return false;
  }

  const asset = value as unknown as Record<string, unknown>;
  return (
    (asset['1d_high'] === undefined || typeof asset['1d_high'] === 'number') &&
    (asset['1d_low'] === undefined || typeof asset['1d_low'] === 'number') &&
    (asset['1d_volume'] === undefined || typeof asset['1d_volume'] === 'number')
  );
};

const isMudrexLeverage = (value: unknown): value is MudrexLeveragePayload => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const leverage = value as Record<string, unknown>;
  return (
    typeof leverage.leverage === 'string' &&
    typeof leverage.margin_type === 'string' &&
    (leverage.collateral_currency_id === undefined ||
      typeof leverage.collateral_currency_id === 'number')
  );
};

const isMudrexOrder = (value: unknown): value is MudrexOrder => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const order = value as Record<string, unknown>;
  const reason = order.reason;

  return (
    typeof order.created_at === 'string' &&
    typeof order.updated_at === 'string' &&
    (reason === null ||
      (typeof reason === 'object' &&
        reason !== null &&
        typeof (reason as Record<string, unknown>).message === 'string')) &&
    typeof order.actual_amount === 'number' &&
    (order.desired_amount === undefined || typeof order.desired_amount === 'number') &&
    typeof order.quantity === 'number' &&
    typeof order.filled_quantity === 'number' &&
    typeof order.price === 'number' &&
    typeof order.filled_price === 'number' &&
    typeof order.leverage === 'number' &&
    (order.liquidation_price === undefined || typeof order.liquidation_price === 'number') &&
    (order.hedge_rate === undefined || typeof order.hedge_rate === 'number') &&
    (order.trade_currency === undefined || typeof order.trade_currency === 'string') &&
    typeof order.order_type === 'string' &&
    typeof order.trigger_type === 'string' &&
    typeof order.status === 'string' &&
    (order.side === undefined || typeof order.side === 'string') &&
    typeof order.id === 'string' &&
    typeof order.asset_uuid === 'string' &&
    typeof order.symbol === 'string'
  );
};

const isMudrexCreateOrderResult = (value: unknown): value is MudrexCreateOrderResult => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.leverage === 'string' &&
    typeof payload.amount === 'string' &&
    typeof payload.quantity === 'string' &&
    typeof payload.price === 'string' &&
    typeof payload.order_id === 'string' &&
    typeof payload.status === 'string' &&
    typeof payload.message === 'string'
  );
};

const isMudrexCancelOrderResult = (value: unknown): value is MudrexCancelOrderResult => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.message === 'string' &&
    typeof payload.order_id === 'string' &&
    typeof payload.status === 'string'
  );
};

const isMudrexPositionExitOrder = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const order = value as Record<string, unknown>;
  return (
    typeof order.price === 'string' &&
    typeof order.order_id === 'string' &&
    typeof order.order_type === 'string'
  );
};

const isMudrexPosition = (value: unknown): value is MudrexPosition => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const position = value as Record<string, unknown>;
  return (
    typeof position.created_at === 'string' &&
    typeof position.updated_at === 'string' &&
    (position.stoploss === null || isMudrexPositionExitOrder(position.stoploss)) &&
    (position.takeprofit === null || isMudrexPositionExitOrder(position.takeprofit)) &&
    typeof position.entry_price === 'string' &&
    typeof position.quantity === 'string' &&
    typeof position.leverage === 'string' &&
    typeof position.liquidation_price === 'string' &&
    typeof position.order_type === 'string' &&
    typeof position.status === 'string' &&
    typeof position.id === 'string' &&
    typeof position.asset_uuid === 'string' &&
    typeof position.symbol === 'string'
  );
};

const isMudrexPositionMarginUpdate = (value: unknown): value is MudrexPositionMarginUpdate => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.message === 'string' &&
    typeof payload.initial_margin === 'string' &&
    typeof payload.liquidation_price === 'string'
  );
};

const isMudrexPositionRiskOrder = (value: unknown): value is MudrexPositionRiskOrder => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.position_id === 'string' &&
    typeof payload.status === 'string' &&
    typeof payload.message === 'string'
  );
};

const isMudrexPositionHistoryItem = (value: unknown): value is MudrexPositionHistoryItem => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    (item.id === undefined || typeof item.id === 'string') &&
    typeof item.position_type === 'string' &&
    typeof item.status === 'string' &&
    typeof item.leverage === 'string' &&
    typeof item.entry_price === 'string' &&
    typeof item.closed_price === 'string' &&
    typeof item.quantity === 'string' &&
    typeof item.pnl === 'string' &&
    typeof item.created_at === 'string' &&
    typeof item.updated_at === 'string' &&
    typeof item.asset_uuid === 'string' &&
    typeof item.symbol === 'string' &&
    (item.trade_currency === undefined || typeof item.trade_currency === 'string') &&
    (item.entry_hedge_rate === undefined || typeof item.entry_hedge_rate === 'string') &&
    (item.exit_hedge_rate === undefined || typeof item.exit_hedge_rate === 'string')
  );
};

const EXCLUDED_FUTURES_ASSET_DETAIL_PATHS = new Set([
  '/fapi/v1/futures/funds',
  '/fapi/v1/futures/orders',
  '/fapi/v1/futures/positions',
]);

const isFuturesAssetDetailPath = (path: string): boolean => {
  if (!/^\/fapi\/v1\/futures\/[^/]+(\?is_symbol)?$/.test(path)) {
    return false;
  }

  return !EXCLUDED_FUTURES_ASSET_DETAIL_PATHS.has(path);
};

const isCreateFuturesOrderPath = (path: string): boolean =>
  /^\/fapi\/v1\/futures\/[^/]+\/order$/.test(path);

const isOrderDetailPath = (path: string): boolean =>
  /^\/fapi\/v1\/futures\/orders\/[^/]+$/.test(path) && path !== '/fapi/v1/futures/orders/history';

const isPositionLiqPricePath = (path: string): boolean =>
  /^\/fapi\/v1\/futures\/positions\/[^/]+\/liq-price$/.test(path);

const isPositionAddMarginPath = (path: string): boolean =>
  /^\/fapi\/v1\/futures\/positions\/[^/]+\/add-margin$/.test(path);

const isPositionRiskOrderPath = (path: string): boolean =>
  /^\/fapi\/v1\/futures\/positions\/[^/]+\/riskorder$/.test(path);

const isPositionReversePath = (path: string): boolean =>
  /^\/fapi\/v1\/futures\/positions\/[^/]+\/reverse$/.test(path);

const isPositionClosePartialPath = (path: string): boolean =>
  /^\/fapi\/v1\/futures\/positions\/[^/]+\/close\/partial$/.test(path);

const isPositionClosePath = (path: string): boolean =>
  /^\/fapi\/v1\/futures\/positions\/[^/]+\/close$/.test(path);

const routeValidationRules: RouteValidationRule[] = [
  {
    matches: (path, method) => method === 'GET' && path === '/fapi/v1/futures',
    isValid: (value) => Array.isArray(value) && value.every(isMudrexAsset),
    message: 'Mudrex returned an invalid futures payload',
  },
  {
    matches: (path) => isFuturesAssetDetailPath(path),
    isValid: (value) => isMudrexAssetDetail(value),
    message: 'Mudrex returned an invalid futures asset payload',
  },
  {
    matches: (path) => isCreateFuturesOrderPath(path),
    isValid: (value) => isMudrexCreateOrderResult(value),
    message: 'Mudrex returned an invalid create order payload',
  },
  {
    matches: (path) => path === '/fapi/v1/wallet/funds',
    isValid: (value) => isMudrexWalletFunds(value),
    message: 'Mudrex returned an invalid wallet funds payload',
  },
  {
    matches: (path) => path === '/fapi/v1/futures/funds',
    isValid: (value) => isMudrexFuturesFunds(value),
    message: 'Mudrex returned an invalid futures funds payload',
  },
  {
    matches: (path) => path === '/fapi/v1/futures/orders',
    isValid: (value) => Array.isArray(value) && value.every(isMudrexOrder),
    message: 'Mudrex returned an invalid futures orders payload',
  },
  {
    matches: (path) => path === '/fapi/v1/futures/orders/history',
    isValid: (value) => Array.isArray(value) && value.every(isMudrexOrder),
    message: 'Mudrex returned an invalid order history payload',
  },
  {
    matches: (path) => isOrderDetailPath(path),
    isValid: (value) => isMudrexOrder(value),
    message: 'Mudrex returned an invalid order detail payload',
  },
  {
    matches: (path, method) => method === 'DELETE' && isOrderDetailPath(path),
    isValid: (value) => isMudrexCancelOrderResult(value),
    message: 'Mudrex returned an invalid cancel order payload',
  },
  {
    matches: (path) => path === '/fapi/v1/futures/positions',
    isValid: (value) => value === null || (Array.isArray(value) && value.every(isMudrexPosition)),
    message: 'Mudrex returned an invalid futures positions payload',
  },
  {
    matches: (path) => isPositionLiqPricePath(path),
    isValid: (value) => typeof value === 'string',
    message: 'Mudrex returned an invalid position liquidation price payload',
  },
  {
    matches: (path) => isPositionAddMarginPath(path),
    isValid: (value) => isMudrexPositionMarginUpdate(value),
    message: 'Mudrex returned an invalid add margin payload',
  },
  {
    matches: (path) =>
      isPositionRiskOrderPath(path) || isPositionReversePath(path) || isPositionClosePath(path),
    isValid: (value) => isMudrexPositionRiskOrder(value),
    message: 'Mudrex returned an invalid position action payload',
  },
  {
    matches: (path) => isPositionClosePartialPath(path),
    isValid: (value) => typeof value === 'boolean',
    message: 'Mudrex returned an invalid partial close payload',
  },
  {
    matches: (path) => path === '/fapi/v1/futures/positions/history',
    isValid: (value) => Array.isArray(value) && value.every(isMudrexPositionHistoryItem),
    message: 'Mudrex returned an invalid position history payload',
  },
  {
    matches: (path) => path.endsWith('/leverage') || path.includes('/leverage?'),
    isValid: (value) => isMudrexLeverage(value),
    message: 'Mudrex returned an invalid leverage payload',
  },
];

const MUDREX_BASE_URL = 'https://trade.mudrex.com';

@Service()
export class MudrexHttpClient {
  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => BrokerRepository)
  private brokerRepository!: BrokerRepository;

  async get<T>(path: string, query?: Record<string, string | number>): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }

  async post<T>(path: string, body?: unknown, query?: Record<string, string | number>): Promise<T> {
    return this.request<T>('POST', path, body, query);
  }

  async patch<T>(
    path: string,
    body?: unknown,
    query?: Record<string, string | number>
  ): Promise<T> {
    return this.request<T>('PATCH', path, body, query);
  }

  async delete<T>(path: string, query?: Record<string, string | number>): Promise<T> {
    return this.request<T>('DELETE', path, undefined, query);
  }

  async authenticatedGet<T>(
    userId: string | undefined,
    accountId: string | undefined,
    path: string,
    query?: Record<string, string | number>
  ): Promise<T> {
    return this.request<T>('GET', path, undefined, query, userId, accountId);
  }

  async authenticatedPost<T>(
    userId: string | undefined,
    accountId: string | undefined,
    path: string,
    body?: unknown,
    query?: Record<string, string | number>
  ): Promise<T> {
    return this.request<T>('POST', path, body, query, userId, accountId);
  }

  async authenticatedPatch<T>(
    userId: string | undefined,
    accountId: string | undefined,
    path: string,
    body?: unknown,
    query?: Record<string, string | number>
  ): Promise<T> {
    return this.request<T>('PATCH', path, body, query, userId, accountId);
  }

  async authenticatedDelete<T>(
    userId: string | undefined,
    accountId: string | undefined,
    path: string,
    query?: Record<string, string | number>
  ): Promise<T> {
    return this.request<T>('DELETE', path, undefined, query, userId, accountId);
  }

  async authenticatedGetWithSettings<T>(
    settings: Record<string, unknown>,
    path: string,
    query?: Record<string, string | number>,
    brokerKey = 'mudrex'
  ): Promise<T> {
    const credentials = await this.resolveCredentialsFromSettings(settings, brokerKey);
    return this.request<T>('GET', path, undefined, query, undefined, undefined, credentials);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    query?: Record<string, string | number>,
    userId?: string,
    accountId?: string,
    inlineCredentials?: MudrexCredentials
  ): Promise<T> {
    const credentials =
      inlineCredentials ??
      (userId && accountId ? await this.resolveCredentials(userId, accountId) : null);
    let attempts = 0;

    while (true) {
      attempts += 1;
      await mudrexRateLimiter.acquire();

      const url = new URL(path, credentials?.baseUrl || MUDREX_BASE_URL);
      if (query) {
        for (const [key, value] of Object.entries(query)) {
          url.searchParams.set(key, String(value));
        }
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.http.requestTimeoutMs);

      try {
        const routePath = `${method} ${path}`;
        const response = await this.performRequest(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(credentials ? { 'X-Authentication': credentials.apiSecret } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        if (response.statusCode === 401 || response.statusCode === 403) {
          throw this.buildApiError(response.statusCode, routePath, {
            statusCode: response.statusCode,
            message: 'Mudrex authentication failed',
            code: String(response.statusCode),
            rawBody: this.truncateRawBody(response.body),
          });
        }

        if (response.statusCode === 429) {
          throw this.buildApiError(429, routePath, {
            statusCode: 429,
            message: 'Mudrex rate limit exceeded',
            code: '429',
            rawBody: this.truncateRawBody(response.body),
          });
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          const parsedError = this.parseErrorResponse(response.statusCode, response.body);

          if (response.statusCode >= 500 && attempts <= MUDREX_MAX_RETRIES) {
            await this.sleep(attempts * 500);
            continue;
          }

          throw this.buildApiError(response.statusCode, routePath, parsedError);
        }

        const payload = JSON.parse(response.body) as MudrexEnvelope<T>;
        if (!payload.success) {
          const firstError = payload.errors?.[0];
          throw this.buildApiError(response.statusCode, routePath, {
            statusCode: Number(firstError?.code || 502),
            message:
              firstError?.text || payload.message || 'Mudrex returned an unsuccessful response',
            code: firstError?.code === undefined ? undefined : String(firstError.code),
            payload,
            rawBody: this.truncateRawBody(response.body),
          });
        }

        this.validatePayload(method, path, payload.data);

        return payload.data;
      } catch (error) {
        if (error instanceof MudrexApiError) {
          if (
            (error.statusCode === 429 || error.statusCode >= 500) &&
            attempts <= MUDREX_MAX_RETRIES
          ) {
            await this.sleep(attempts * 500);
            continue;
          }

          throw error;
        }

        if (
          (error instanceof Error && error.name === 'AbortError') ||
          (error instanceof Error && error.message === 'Request aborted')
        ) {
          if (attempts <= MUDREX_MAX_RETRIES) {
            await this.sleep(attempts * 500);
            continue;
          }

          throw this.buildApiError(504, `${method} ${path}`, {
            statusCode: 504,
            message: 'Mudrex request timed out',
            code: '504',
          });
        }

        throw this.buildApiError(503, `${method} ${path}`, {
          statusCode: 503,
          message: `Mudrex request failed${error instanceof Error && error.message ? `: ${error.message}` : ''}`,
          code: '503',
          payload:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                }
              : {
                  value: String(error),
                },
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  private buildApiError(
    httpStatusCode: number,
    routePath: string,
    parsed: MudrexParsedError
  ): MudrexApiError {
    return new MudrexApiError(parsed.statusCode, parsed.message, {
      brokerStatusCode: httpStatusCode,
      brokerRoutePath: routePath,
      brokerErrorCode: parsed.code ?? String(parsed.statusCode),
      brokerErrorMessage: parsed.message,
      brokerErrorPayload:
        parsed.payload ?? (parsed.rawBody ? { rawBody: parsed.rawBody } : undefined),
    });
  }

  private truncateRawBody(body: string, maxLength = 2000): string | undefined {
    const raw = String(body || '').trim();
    if (!raw) {
      return undefined;
    }

    return raw.length <= maxLength ? raw : `${raw.slice(0, maxLength)}...`;
  }

  private async sleep(durationMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  }

  private async resolveCredentials(userId: string, accountId: string): Promise<MudrexCredentials> {
    if (!userId.trim() || !accountId.trim()) {
      throw new BadRequestAppError('Mudrex routing requires both userId and accountId');
    }

    const account = await this.brokerAccountRepository.getBrokerAccountById(userId, accountId);

    if (!account) {
      throw new BadRequestAppError('Broker account not found for Mudrex');
    }

    const settings = (account.settings ?? {}) as Record<string, unknown>;
    return this.resolveCredentialsFromSettings(
      decryptBrokerAccountSettings(settings) ?? {},
      account.brokerKey || 'mudrex'
    );
  }

  private async resolveCredentialsFromSettings(
    settings: Record<string, unknown>,
    brokerKey: string
  ): Promise<MudrexCredentials> {
    const apiSecret = String(settings.apiSecret ?? '').trim();
    const configuredBaseUrl = String(settings.baseUrl ?? '').trim();
    const baseUrl = configuredBaseUrl
      ? configuredBaseUrl.replace(/\/+$/, '')
      : ((await this.resolveBrokerBaseUrl(brokerKey)) || MUDREX_BASE_URL).replace(/\/+$/, '');

    if (!apiSecret) {
      throw new MudrexConfigurationError(
        'Mudrex account is missing apiSecret in broker account settings'
      );
    }

    if (apiSecret.toLowerCase() === 'replace-me') {
      throw new MudrexConfigurationError(
        'Mudrex account is still using placeholder credentials; update apiSecret in broker account settings'
      );
    }

    return { apiSecret, baseUrl };
  }

  private async resolveBrokerBaseUrl(brokerKey: string): Promise<string | null> {
    const broker = await this.brokerRepository.getBrokerByKey(brokerKey.trim().toLowerCase());
    const baseUrl = String(broker?.baseUrl || '').trim();
    return baseUrl || null;
  }

  private validatePayload(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    data: unknown
  ): void {
    const matchingRule = routeValidationRules.find((rule) => rule.matches(path, method));

    if (matchingRule && !matchingRule.isValid(data)) {
      throw new MudrexApiError(502, matchingRule.message);
    }
  }

  private parseErrorResponse(statusCode: number, body: string): MudrexParsedError {
    try {
      const parsed = JSON.parse(body) as
        | MudrexEnvelope<unknown>
        | {
            message?: string;
            errors?: Array<{ code?: number; text?: string }>;
          };

      const nestedMessage =
        typeof parsed.message === 'string' && parsed.message.trim().startsWith('{')
          ? (JSON.parse(parsed.message) as {
              errors?: Array<{ code?: number; text?: string }>;
              success?: boolean;
            })
          : null;

      const firstError = parsed.errors?.[0] || nestedMessage?.errors?.[0];

      return {
        statusCode: firstError?.code || statusCode,
        code: firstError?.code === undefined ? undefined : String(firstError.code),
        message:
          firstError?.text ||
          (typeof parsed.message === 'string' ? parsed.message : '') ||
          `Mudrex request failed with status ${statusCode}`,
        payload: parsed,
        rawBody: this.truncateRawBody(body),
      };
    } catch {
      return {
        statusCode,
        message: `Mudrex request failed with status ${statusCode}`,
        code: String(statusCode),
        rawBody: this.truncateRawBody(body),
      };
    }
  }

  private async performRequest(
    url: URL,
    options: {
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      headers: Record<string, string>;
      body?: string;
      signal: AbortSignal;
    }
  ): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const request = https.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: options.method,
          headers: options.headers,
          maxRedirects: 20,
        },
        (response: NodeJS.ReadableStream & { statusCode?: number }) => {
          const chunks: Buffer[] = [];

          response.on('data', (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });

          response.on('end', () => {
            resolve({
              statusCode: response.statusCode ?? 500,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });

          response.on('error', reject);
        }
      );

      request.on('error', reject);

      const onAbort = () => {
        request.destroy(new Error('Request aborted'));
      };

      options.signal.addEventListener('abort', onAbort, { once: true });

      request.on('close', () => {
        options.signal.removeEventListener('abort', onAbort);
      });

      if (options.body) {
        request.write(options.body);
      }

      request.end();
    });
  }
}

export const validateMudrexStartupConfiguration = (): string | null => {
  if (env.app.requireApiKey && !env.app.apiKey.trim()) {
    return 'APP_API_KEY is not configured while APP_REQUIRE_API_KEY is enabled; protected routes will reject requests.';
  }

  return null;
};
