import { Service } from 'typedi';
import {
  BadGatewayAppError,
  ServiceUnavailableAppError,
  UnauthorizedAppError,
} from '../errors/AppError';
import { DiscoveryFeedItem, DiscoveryFeedResponse } from '../contracts/Discovery';
import { env } from '../../env';

interface DiscoveryFeedQuery {
  limit?: string;
  botId?: string;
}

interface DiscoveryRunsListResponse {
  items: DiscoveryRunListItem[];
  total: number;
}

interface DiscoveryRunListItem {
  id?: string | null;
  bot_id?: string | null;
  status?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  duration_seconds?: number | null;
  assets_scanned?: number | null;
  strategies_discovered?: number | null;
  run_config?: {
    assets?: unknown;
    timeframes?: unknown;
  } | null;
  error_message?: string | null;
}

interface DiscoveryHttpResult<T> {
  ok: boolean;
  httpStatus?: number;
  payload?: T;
  detail?: string;
}

@Service()
export class DiscoveryFeedService {
  private static readonly DEFAULT_LIMIT = 20;
  private static readonly MAX_LIMIT = 100;

  async getFeed(
    authorizationHeader?: string | null,
    query: DiscoveryFeedQuery = {}
  ): Promise<DiscoveryFeedResponse> {
    const normalizedAuthHeader = String(authorizationHeader || '').trim();
    if (!normalizedAuthHeader) {
      throw new UnauthorizedAppError(
        'Authorization header is required to load discovery feed history'
      );
    }

    const limit = this.normalizeLimit(query.limit);
    const normalizedBotId = this.normalizeOptionalString(query.botId);
    const response = await this.fetchRunsPage(
      {
        limit,
        offset: 0,
        ...(normalizedBotId ? { bot_id: normalizedBotId } : {}),
      },
      normalizedAuthHeader
    );

    const items = response.items
      .map((run) => this.mapRunToFeedItem(run))
      .sort((left, right) => {
        const leftTime = Date.parse(left.occurredAt || '');
        const rightTime = Date.parse(right.occurredAt || '');
        return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
      });

    return {
      checkedAt: new Date().toISOString(),
      items,
    };
  }

  private mapRunToFeedItem(run: DiscoveryRunListItem): DiscoveryFeedItem {
    const runId = this.normalizeOptionalString(run.id) || 'unknown-run';
    const botId = this.normalizeOptionalString(run.bot_id);
    const status = this.normalizeOptionalString(run.status)?.toLowerCase() || 'unknown';
    const startedAt = this.normalizeOptionalString(run.started_at);
    const completedAt = this.normalizeOptionalString(run.completed_at);
    const occurredAt = completedAt || startedAt || new Date().toISOString();
    const type =
      status === 'running' || status === 'queued' ? 'run_progress' : 'run_completed';

    return {
      id: `history:${type}:${runId}`,
      source: 'history',
      type,
      occurredAt,
      runId,
      ...(botId ? { botId } : {}),
      status,
      strategiesFound: this.normalizeOptionalNumber(run.strategies_discovered) || 0,
      assetsScanned: this.normalizeOptionalNumber(run.assets_scanned) || 0,
      durationSeconds: this.normalizeOptionalNumber(run.duration_seconds),
      ...(startedAt ? { startedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
      ...(this.normalizeOptionalString(run.error_message)
        ? { errorMessage: this.normalizeOptionalString(run.error_message) }
        : {}),
      timeframes: this.normalizeStringArray(run.run_config?.timeframes),
      assets: this.normalizeStringArray(run.run_config?.assets),
    };
  }

  private normalizeOptionalString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalizeOptionalNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }

  private normalizeLimit(limit: string | undefined): number {
    const parsed = Number(limit);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DiscoveryFeedService.DEFAULT_LIMIT;
    }
    return Math.max(1, Math.min(DiscoveryFeedService.MAX_LIMIT, Math.floor(parsed)));
  }

  private async fetchRunsPage(
    params: Record<string, string | number | undefined>,
    authorizationHeader: string
  ): Promise<DiscoveryRunsListResponse> {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        search.set(key, String(value));
      }
    });

    const suffix = search.toString() ? `?${search.toString()}` : '';
    const result = await this.fetchJson<DiscoveryRunsListResponse>(
      `${this.resolveDiscoveryApiBaseUrl()}/runs${suffix}`,
      authorizationHeader
    );

    if (!result.ok) {
      if (result.httpStatus === 401 || result.httpStatus === 403) {
        throw new BadGatewayAppError(
          'Discovery engine rejected the forwarded aurAlpha token while loading discovery feed history'
        );
      }

      throw new BadGatewayAppError(
        result.detail || 'Discovery engine request failed for discovery feed history'
      );
    }

    const payload = result.payload;
    if (
      !payload ||
      typeof payload !== 'object' ||
      !Array.isArray((payload as DiscoveryRunsListResponse).items) ||
      !Number.isFinite((payload as DiscoveryRunsListResponse).total)
    ) {
      throw new BadGatewayAppError(
        'Discovery engine returned an invalid run list payload for discovery feed history'
      );
    }

    return {
      items: (payload as DiscoveryRunsListResponse).items,
      total: Number((payload as DiscoveryRunsListResponse).total || 0),
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

  private async fetchJson<T>(
    url: string,
    authorizationHeader: string
  ): Promise<DiscoveryHttpResult<T>> {
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
          ? `Discovery engine feed request failed: ${error.message}`
          : `Discovery engine feed request failed: ${String(error)}`
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
