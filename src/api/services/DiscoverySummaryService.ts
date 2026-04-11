import { Service } from 'typedi';
import { BadGatewayAppError, ServiceUnavailableAppError, UnauthorizedAppError } from '../errors/AppError';
import { DiscoverySummaryResponse } from '../contracts/Discovery';
import { env } from '../../env';

interface DiscoveryListResponse<T> {
  items: T[];
  total: number;
}

interface DiscoveryBotListItem {
  status?: string | null;
}

interface DiscoveryStrategyListItem {
  score?: number | null;
}

interface DiscoveryHttpResult<T> {
  ok: boolean;
  httpStatus?: number;
  payload?: T;
  detail?: string;
}

@Service()
export class DiscoverySummaryService {
  private static readonly BOT_SCAN_PAGE_SIZE = 200;

  async getSummary(authorizationHeader?: string | null): Promise<DiscoverySummaryResponse> {
    const normalizedAuthHeader = String(authorizationHeader || '').trim();
    if (!normalizedAuthHeader) {
      throw new UnauthorizedAppError('Authorization header is required to load discovery summary');
    }

    const [botOverview, pendingReviewOverview, strategiesOverview, suggestionsOverview, runsOverview] =
      await Promise.all([
        this.fetchListPage<DiscoveryBotListItem>('/bots', { limit: 1, offset: 0 }, normalizedAuthHeader),
        this.fetchListPage<DiscoveryStrategyListItem>(
          '/strategies',
          { limit: 1, offset: 0, status: 'pending_review' },
          normalizedAuthHeader
        ),
        this.fetchListPage<DiscoveryStrategyListItem>(
          '/strategies',
          { limit: 1, offset: 0 },
          normalizedAuthHeader
        ),
        this.fetchListPage('/template-suggestions', { limit: 1, offset: 0 }, normalizedAuthHeader),
        this.fetchListPage('/runs', { limit: 1, offset: 0 }, normalizedAuthHeader),
      ]);

    const activeBots = botOverview.total
      ? await this.countActiveBots(normalizedAuthHeader, botOverview.total)
      : 0;
    const bestScore = this.readBestScore(strategiesOverview.items);

    return {
      checkedAt: new Date().toISOString(),
      bots: {
        total: botOverview.total,
        active: activeBots,
      },
      strategies: {
        total: strategiesOverview.total,
        pendingReview: pendingReviewOverview.total,
        bestScore,
      },
      suggestions: {
        total: suggestionsOverview.total,
      },
      runs: {
        total: runsOverview.total,
      },
    };
  }

  private async countActiveBots(authorizationHeader: string, total: number): Promise<number> {
    let offset = 0;
    let activeCount = 0;

    while (offset < total) {
      const page = await this.fetchListPage<DiscoveryBotListItem>(
        '/bots',
        {
          limit: DiscoverySummaryService.BOT_SCAN_PAGE_SIZE,
          offset,
        },
        authorizationHeader
      );

      if (!page.items.length) {
        break;
      }

      activeCount += page.items.filter((item) => this.isActiveBotStatus(item?.status)).length;
      offset += page.items.length;
    }

    return activeCount;
  }

  private isActiveBotStatus(status: unknown): boolean {
    return String(status || '').trim().toLowerCase() === 'running';
  }

  private readBestScore(items: DiscoveryStrategyListItem[]): number | null {
    const firstItem = items[0];
    const score = firstItem?.score;
    return typeof score === 'number' && Number.isFinite(score) ? score : null;
  }

  private async fetchListPage<T = unknown>(
    path: string,
    params: Record<string, string | number | undefined>,
    authorizationHeader: string
  ): Promise<DiscoveryListResponse<T>> {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        search.set(key, String(value));
      }
    });

    const suffix = search.toString() ? `?${search.toString()}` : '';
    const result = await this.fetchJson<DiscoveryListResponse<T>>(
      `${this.resolveDiscoveryApiBaseUrl()}${path}${suffix}`,
      authorizationHeader
    );

    if (!result.ok) {
      if (result.httpStatus === 401 || result.httpStatus === 403) {
        throw new BadGatewayAppError(
          'Discovery engine rejected the forwarded aurAlpha token while loading discovery summary'
        );
      }

      throw new BadGatewayAppError(
        result.detail || `Discovery engine request failed for ${path}`
      );
    }

    const payload = result.payload;
    if (
      !payload ||
      typeof payload !== 'object' ||
      !Array.isArray((payload as DiscoveryListResponse<T>).items) ||
      !Number.isFinite((payload as DiscoveryListResponse<T>).total)
    ) {
      throw new BadGatewayAppError(
        `Discovery engine returned an invalid list payload for ${path}`
      );
    }

    return {
      items: (payload as DiscoveryListResponse<T>).items,
      total: Number((payload as DiscoveryListResponse<T>).total || 0),
    };
  }

  private resolveDiscoveryApiBaseUrl(): string {
    const configured = String(env.discovery.apiBaseUrl || '').trim();
    const fallback = 'http://localhost:8000/api/v1/discovery';
    if (!configured) {
      return fallback;
    }

    try {
      const url = new URL(configured);
      url.pathname = url.pathname.replace(/\/+$/, '');
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/+$/, '');
    } catch {
      return fallback;
    }
  }

  private async fetchJson<T>(url: string, authorizationHeader: string): Promise<DiscoveryHttpResult<T>> {
    const controller = new AbortController();
    const timeoutMs = Math.max(1000, Math.min(env.http.requestTimeoutMs, 5000));
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: authorizationHeader,
        },
        signal: controller.signal,
      });

      const text = await response.text();
      let payload: T | undefined;
      if (text) {
        try {
          payload = JSON.parse(text) as T;
        } catch {
          payload = undefined;
        }
      }

      return {
        ok: response.ok,
        httpStatus: response.status,
        payload,
        ...(response.ok
          ? {}
          : {
              detail:
                (payload &&
                typeof payload === 'object' &&
                !Array.isArray(payload) &&
                typeof (payload as { detail?: unknown }).detail === 'string'
                  ? String((payload as { detail?: string }).detail)
                  : undefined) || `Discovery engine HTTP ${response.status}`,
            }),
      };
    } catch (error) {
      throw new ServiceUnavailableAppError(
        error instanceof Error
          ? `Discovery engine summary request failed: ${error.message}`
          : `Discovery engine summary request failed: ${String(error)}`
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
