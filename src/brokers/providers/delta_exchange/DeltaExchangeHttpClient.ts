import { createHmac } from 'crypto';
import { https } from 'follow-redirects';
import { Inject, Service } from 'typedi';
import {
  BadGatewayAppError,
  BadRequestAppError,
  RateLimitAppError,
  ServiceUnavailableAppError,
  UnauthorizedAppError,
} from '../../../api';
import { BrokerAccountRepository, BrokerRepository } from '../../../database';
import { decryptBrokerAccountSettings } from '../../../lib/brokerAccountSecrets';

const DELTA_EXCHANGE_BASE_URL = 'https://api.india.delta.exchange';

interface DeltaEnvelope<T> {
  success: boolean;
  result: T;
  meta?: {
    after?: string | null;
    before?: string | null;
  };
}

interface DeltaCredentials {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
}

@Service()
export class DeltaExchangeHttpClient {
  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => BrokerRepository)
  private brokerRepository!: BrokerRepository;

  async publicGet<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('GET', path, { query });
  }

  async signedGet<T>(
    accountId: string | undefined,
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    userId?: string
  ): Promise<T> {
    const credentials = await this.resolveCredentials(accountId, userId);
    return this.request<T>('GET', path, { query, credentials });
  }

  async signedGetEnvelope<T>(
    accountId: string | undefined,
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    userId?: string
  ): Promise<DeltaEnvelope<T>> {
    const credentials = await this.resolveCredentials(accountId, userId);
    return this.request<DeltaEnvelope<T>>('GET', path, { query, credentials }, false);
  }

  async signedGetWithSettings<T>(
    settings: Record<string, unknown>,
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    brokerKey = 'delta_exchange'
  ): Promise<T> {
    const credentials = await this.resolveCredentialsFromSettings(settings, brokerKey);
    return this.request<T>('GET', path, { query, credentials });
  }

  async signedPost<T>(
    accountId: string | undefined,
    path: string,
    body?: unknown,
    userId?: string
  ): Promise<T> {
    const credentials = await this.resolveCredentials(accountId, userId);
    return this.request<T>('POST', path, { body, credentials });
  }

  async signedDelete<T>(
    accountId: string | undefined,
    path: string,
    body?: unknown,
    userId?: string,
    query?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    const credentials = await this.resolveCredentials(accountId, userId);
    return this.request<T>('DELETE', path, { body, query, credentials });
  }

  private async resolveCredentials(
    accountId?: string,
    userId?: string
  ): Promise<DeltaCredentials> {
    if (!accountId) {
      throw new BadRequestAppError('Delta Exchange routing requires accountId');
    }

    const resolvedUserId = String(userId || this.extractUserId(accountId)).trim();
    const account = await this.brokerAccountRepository.getBrokerAccountById(
      resolvedUserId,
      accountId
    );

    if (!account) {
      throw new BadRequestAppError('Broker account not found for Delta Exchange');
    }

    const settings = (account.settings ?? {}) as Record<string, unknown>;
    return this.resolveCredentialsFromSettings(
      decryptBrokerAccountSettings(settings) ?? {},
      account.brokerKey || 'delta_exchange'
    );
  }

  private async resolveCredentialsFromSettings(
    settings: Record<string, unknown>,
    brokerKey: string
  ): Promise<DeltaCredentials> {
    const apiKey = String(settings.apiKey ?? '').trim();
    const apiSecret = String(settings.apiSecret ?? '').trim();
    const configuredBaseUrl = String(settings.baseUrl ?? '').trim();
    const baseUrl = configuredBaseUrl
      ? configuredBaseUrl.replace(/\/+$/, '')
      : ((await this.resolveBrokerBaseUrl(brokerKey)) || DELTA_EXCHANGE_BASE_URL).replace(
          /\/+$/,
          ''
        );

    if (!apiKey || !apiSecret) {
      throw new ServiceUnavailableAppError(
        'Delta Exchange account is missing apiKey/apiSecret in broker account settings'
      );
    }

    if (
      apiKey.toLowerCase() === 'replace-me' ||
      apiSecret.toLowerCase() === 'replace-me'
    ) {
      throw new ServiceUnavailableAppError(
        'Delta Exchange account is still using placeholder credentials; update apiKey/apiSecret in broker account settings'
      );
    }

    return { apiKey, apiSecret, baseUrl };
  }

  private async resolveBrokerBaseUrl(brokerKey: string): Promise<string | null> {
    const broker = await this.brokerRepository.getBrokerByKey(brokerKey.trim().toLowerCase());
    const baseUrl = String(broker?.baseUrl || '').trim();
    return baseUrl || null;
  }

  private extractUserId(accountId: string): string {
    const parts = accountId.split(':');
    return parts.length > 1 ? parts[0] : '';
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    routePath: string,
    options: {
      query?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
      credentials?: DeltaCredentials;
    } = {},
    unwrapResult = true
  ): Promise<T> {
    const queryString = this.toQueryString(options.query);
    const requestPath = queryString ? `${routePath}?${queryString}` : routePath;
    const baseUrl = options.credentials?.baseUrl ?? DELTA_EXCHANGE_BASE_URL;
    const url = new URL(requestPath, baseUrl);
    const bodyString =
      options.body === undefined ? '' : JSON.stringify(options.body);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'AurAlpha/1.0',
    };
    if (bodyString) {
      headers['Content-Length'] = Buffer.byteLength(bodyString).toString();
    }

    const signedHeaders = options.credentials
      ? this.buildSignedHeaders(options.credentials, method, routePath, queryString, bodyString)
      : {};

    const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const request = https.request(
        url,
        {
          method,
          headers: {
            ...headers,
            ...signedHeaders,
          },
        },
        (responseStream) => {
          const chunks: Buffer[] = [];

          responseStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          responseStream.on('end', () =>
            resolve({
              statusCode: responseStream.statusCode ?? 500,
              body: Buffer.concat(chunks).toString('utf8'),
            })
          );
        }
      );

      request.on('error', reject);

      if (bodyString) {
        request.write(bodyString);
      }

      request.end();
    });

    let parsed: unknown;
    try {
      parsed = this.parseBody(response.body);
    } catch {
      const snippet = String(response.body || '')
        .slice(0, 500)
        .replace(/\s+/g, ' ')
        .trim();
      throw new BadGatewayAppError(
        `Delta Exchange returned a non-JSON response (status ${response.statusCode}) for ${routePath}${
          snippet ? `: ${snippet}` : ''
        }`
      );
    }

    if (response.statusCode >= 400) {
      this.throwMappedError(response.statusCode, parsed, routePath);
    }

    if (parsed && typeof parsed === 'object' && 'success' in parsed && parsed.success === false) {
      this.throwMappedError(response.statusCode, parsed, routePath);
    }

    if (unwrapResult && parsed && typeof parsed === 'object' && 'result' in parsed) {
      return (parsed as { result: unknown }).result as T;
    }

    return parsed as T;
  }

  private buildSignedHeaders(
    credentials: DeltaCredentials,
    method: string,
    routePath: string,
    queryString: string,
    bodyString: string
  ) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    // Delta expects the JSON body to be included in the signature for non-GET requests (including DELETE).
    const signBody = method.toUpperCase() === 'GET' ? '' : bodyString;
    const signaturePayload = `${method.toUpperCase()}${timestamp}${routePath}${queryString ? `?${queryString}` : ''}${signBody}`;
    const signature = createHmac('sha256', credentials.apiSecret)
      .update(signaturePayload)
      .digest('hex');

    return {
      'api-key': credentials.apiKey,
      timestamp,
      signature,
    };
  }

  private toQueryString(query?: Record<string, string | number | boolean | undefined>): string {
    if (!query) {
      return '';
    }

    const params = new URLSearchParams();

    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        return;
      }

      params.append(key, String(value));
    });

    return params.toString();
  }

  private parseBody(body: string): unknown {
    if (!body) {
      return null;
    }

    try {
      return JSON.parse(body);
    } catch {
      throw new BadGatewayAppError('Delta Exchange returned a non-JSON response');
    }
  }

  private throwMappedError(statusCode: number, parsed: unknown, routePath?: string): never {
    const payload =
      parsed && typeof parsed === 'object'
        ? (parsed as { error?: { message?: string } | string; message?: string })
        : undefined;

    const errorField = payload?.error;
    const errorMessage =
      typeof errorField === 'string' ? errorField : errorField?.message;
    const baseMessage = errorMessage || payload?.message;

    const fallbackParts: string[] = [];
    fallbackParts.push(`Delta Exchange request failed (status ${statusCode})`);
    if (routePath) fallbackParts.push(`for ${routePath}`);
    let fallback = fallbackParts.join(' ');

    // If Delta returns a structured error payload without a top-level message, include a short snippet.
    if (!baseMessage && parsed && typeof parsed === 'object') {
      try {
        const snippet = JSON.stringify(parsed).slice(0, 300);
        if (snippet && snippet !== '{}' && snippet !== '[]') {
          fallback = `${fallback}: ${snippet}`;
        }
      } catch {
        // ignore
      }
    }

    const message = baseMessage
      ? `${baseMessage}${routePath ? ` (route ${routePath})` : ''}`
      : fallback;

    if (statusCode === 401 || statusCode === 403) {
      throw new UnauthorizedAppError(message);
    }

    if (statusCode === 429) {
      throw new RateLimitAppError(message);
    }

    if (statusCode >= 500) {
      throw new ServiceUnavailableAppError(message);
    }

    throw new BadRequestAppError(message);
  }
}
