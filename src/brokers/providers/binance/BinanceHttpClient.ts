import { https } from 'follow-redirects';
import { Inject, Service } from 'typedi';
import {
  BadGatewayAppError,
  RateLimitAppError,
  ServiceUnavailableAppError,
} from '../../../api';
import { env } from '../../../env';
import { ExchangeRepository } from '../../../database';

const BINANCE_FUTURES_BASE_URL = 'https://fapi.binance.com';

@Service()
export class BinanceHttpClient {
  @Inject(() => ExchangeRepository)
  private exchangeRepository!: ExchangeRepository;

  async get<T>(path: string, query?: Record<string, string | number>): Promise<T> {
    const baseUrl = await this.resolveBaseUrl();
    const url = new URL(path, baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await this.performRequest(url);

    if (response.statusCode === 429) {
      throw new RateLimitAppError('Binance rate limit exceeded');
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new ServiceUnavailableAppError(
        `Binance request failed with status ${response.statusCode}`
      );
    }

    try {
      return JSON.parse(response.body) as T;
    } catch {
      throw new BadGatewayAppError('Binance returned an invalid response payload');
    }
  }

  private async performRequest(url: URL): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const request = https.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
          maxRedirects: 10,
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

      request.setTimeout(env.http.requestTimeoutMs, () => {
        request.destroy(new Error('Request timed out'));
      });

      request.on('error', (error) => {
        if (error instanceof Error && error.message === 'Request timed out') {
          reject(new ServiceUnavailableAppError('Binance request timed out'));
          return;
        }

        reject(
          new ServiceUnavailableAppError(
            `Binance request failed${error instanceof Error ? `: ${error.message}` : ''}`
          )
        );
      });

      request.end();
    });
  }

  private async resolveBaseUrl(): Promise<string> {
    const exchange = await this.exchangeRepository.getExchangeByKey('binance');
    const configuredBaseUrl = String(exchange?.baseUrl || '').trim();
    return (configuredBaseUrl || BINANCE_FUTURES_BASE_URL).replace(/\/+$/, '');
  }
}
