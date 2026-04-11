import { Service } from 'typedi';
import {
  DiscoveryDependencyCheck,
  DiscoveryDependencyHealthResponse,
  DiscoveryDependencyReadinessDependency,
} from '../contracts/Discovery';
import { env } from '../../env';

type HttpProbeResult = {
  ok: boolean;
  httpStatus?: number;
  latencyMs: number;
  payload?: unknown;
  detail?: string;
};

type ContractEndpointDefinition = {
  key: string;
  label: string;
  path: string;
  validate: (payload: unknown) => string | null;
};

type SampledContractEndpointDefinition = {
  key: string;
  label: string;
  sourceKey: string;
  buildPath: (sampleId: string) => string;
  validate: (payload: unknown, sampleId: string) => string | null;
};

@Service()
export class DiscoveryDependencyService {
  private static readonly CONTRACT_ENDPOINTS: ContractEndpointDefinition[] = [
    {
      key: 'bots',
      label: 'Bots list',
      path: '/bots?limit=1&offset=0',
      validate: (payload: unknown) =>
        DiscoveryDependencyService.validateListPayload(payload, ['items', 'total']),
    },
    {
      key: 'runs',
      label: 'Runs list',
      path: '/runs?limit=1&offset=0',
      validate: (payload: unknown) =>
        DiscoveryDependencyService.validateListPayload(payload, ['items', 'total']),
    },
    {
      key: 'strategies',
      label: 'Strategies list',
      path: '/strategies?limit=1&offset=0',
      validate: (payload: unknown) =>
        DiscoveryDependencyService.validateListPayload(payload, ['items', 'total']),
    },
    {
      key: 'template-suggestions',
      label: 'Template suggestions list',
      path: '/template-suggestions?limit=1&offset=0',
      validate: (payload: unknown) =>
        DiscoveryDependencyService.validateListPayload(payload, ['items', 'total']),
    },
    {
      key: 'preferences',
      label: 'Preferences',
      path: '/preferences',
      validate: (payload: unknown) =>
        DiscoveryDependencyService.validatePreferencePayload(payload),
    },
  ];

  private static readonly SAMPLED_DETAIL_ENDPOINTS: SampledContractEndpointDefinition[] = [
    {
      key: 'bot-detail',
      label: 'Bot detail',
      sourceKey: 'bots',
      buildPath: (sampleId: string) => `/bots/${encodeURIComponent(sampleId)}`,
      validate: (payload: unknown, sampleId: string) =>
        DiscoveryDependencyService.validateBotDetailPayload(payload, sampleId),
    },
    {
      key: 'run-detail',
      label: 'Run detail',
      sourceKey: 'runs',
      buildPath: (sampleId: string) => `/runs/${encodeURIComponent(sampleId)}`,
      validate: (payload: unknown, sampleId: string) =>
        DiscoveryDependencyService.validateRunDetailPayload(payload, sampleId),
    },
    {
      key: 'strategy-detail',
      label: 'Strategy detail',
      sourceKey: 'strategies',
      buildPath: (sampleId: string) => `/strategies/${encodeURIComponent(sampleId)}`,
      validate: (payload: unknown, sampleId: string) =>
        DiscoveryDependencyService.validateStrategyDetailPayload(payload, sampleId),
    },
  ];

  async getDependencyHealth(
    authorizationHeader?: string | null
  ): Promise<DiscoveryDependencyHealthResponse> {
    const checkedAt = new Date().toISOString();
    const baseUrl = this.resolveDiscoveryApiBaseUrl();
    const serviceBaseUrl = this.resolveDiscoveryServiceBaseUrl(baseUrl);
    const normalizedAuthHeader = String(authorizationHeader || '').trim();

    const serviceProbe = await this.fetchJson(`${serviceBaseUrl}/health`);
    const service = this.mapServiceProbe(serviceProbe);

    const readinessProbe = await this.fetchJson(`${serviceBaseUrl}/health/ready`);
    const readiness = this.mapReadinessProbe(readinessProbe);

    let auth: DiscoveryDependencyCheck = {
      key: 'auth',
      label: 'Auth bridge',
      status: 'down',
      detail: 'Discovery dependency auth check did not run.',
    };
    const endpoints: DiscoveryDependencyCheck[] = [];
    const endpointPayloadByKey = new Map<string, unknown>();

    if (!normalizedAuthHeader) {
      auth = {
        key: 'auth',
        label: 'Auth bridge',
        status: 'down',
        detail: 'Authorization header is required to validate discovery dependency auth.',
      };
    } else {
      const firstEndpoint = DiscoveryDependencyService.CONTRACT_ENDPOINTS[0];
      const authProbe = await this.fetchJson(`${baseUrl}${firstEndpoint.path}`, {
        headers: {
          authorization: normalizedAuthHeader,
        },
      });

      if (!authProbe.ok && (authProbe.httpStatus === 401 || authProbe.httpStatus === 403)) {
        auth = {
          key: 'auth',
          label: 'Auth bridge',
          status: 'down',
          httpStatus: authProbe.httpStatus,
          latencyMs: authProbe.latencyMs,
          detail:
            authProbe.detail ||
            'Discovery engine rejected the forwarded aurAlpha bearer token.',
        };
        endpoints.push(
          {
            ...this.mapContractProbe(
              firstEndpoint.key,
              firstEndpoint.label,
              authProbe,
              'Discovery engine rejected the forwarded aurAlpha bearer token.'
            ),
            probeMode: 'direct',
          }
        );
      } else {
        auth = {
          key: 'auth',
          label: 'Auth bridge',
          status: authProbe.ok ? 'ok' : 'down',
          httpStatus: authProbe.httpStatus,
          latencyMs: authProbe.latencyMs,
          ...(authProbe.ok
            ? {}
            : {
                detail:
                  authProbe.detail ||
                  'Discovery dependency auth bridge failed before contract validation.',
              }),
        };

        endpoints.push(
          {
            ...this.mapValidatedContractProbe(
              firstEndpoint.key,
              firstEndpoint.label,
              authProbe,
              firstEndpoint.validate
            ),
            probeMode: 'direct',
          }
        );
        endpointPayloadByKey.set(firstEndpoint.key, authProbe.payload);

        if (authProbe.ok) {
          const remainingEndpoints = DiscoveryDependencyService.CONTRACT_ENDPOINTS.slice(1);
          const remainingProbes = await Promise.all(
            remainingEndpoints.map((endpoint) =>
              this.fetchJson(`${baseUrl}${endpoint.path}`, {
                headers: {
                  authorization: normalizedAuthHeader,
                },
              }).then((probe) => ({
                endpoint,
                probe,
                check: {
                  ...this.mapValidatedContractProbe(
                    endpoint.key,
                    endpoint.label,
                    probe,
                    endpoint.validate
                  ),
                  probeMode: 'direct' as const,
                },
              }))
            )
          );
          remainingProbes.forEach(({ endpoint, probe, check }) => {
            endpoints.push(check);
            endpointPayloadByKey.set(endpoint.key, probe.payload);
          });

          const sampledDetailChecks = await Promise.all(
            DiscoveryDependencyService.SAMPLED_DETAIL_ENDPOINTS.map((endpoint) =>
              this.runSampledDetailProbe({
                baseUrl,
                authorizationHeader: normalizedAuthHeader,
                sourcePayload: endpointPayloadByKey.get(endpoint.sourceKey),
                endpoint,
              })
            )
          );
          endpoints.push(...sampledDetailChecks);
        }
      }
    }

    const failingChecks = [service, readiness, auth, ...endpoints].filter(
      (item) => item.status !== 'ok'
    );
    const contractFailures = endpoints.filter((item) => item.status !== 'ok');
    const contractStatus =
      auth.status !== 'ok' || contractFailures.length > 0 ? 'down' : 'ok';
    const overallStatus =
      service.status === 'down' || auth.status === 'down'
        ? 'down'
        : readiness.status !== 'ok' || contractFailures.length > 0
          ? 'degraded'
          : 'ok';

    return {
      status: overallStatus,
      checkedAt,
      baseUrl,
      service,
      readiness: {
        ...readiness,
      },
      auth,
      contract: {
        key: 'contract',
        label: 'External API contract',
        status: contractStatus,
        checkedEndpoints: endpoints.map((item) => item.key),
        ...(contractFailures.length > 0
          ? {
              detail: contractFailures
                .map((item) => `${item.label}: ${item.detail || item.status}`)
                .join(' '),
            }
          : {}),
      },
      endpoints,
      ...(failingChecks.length > 0
        ? {
            detail: failingChecks
              .map((item) => `${item.label}: ${item.detail || item.status}`)
              .join(' '),
          }
        : {}),
    };
  }

  private async runSampledDetailProbe({
    baseUrl,
    authorizationHeader,
    sourcePayload,
    endpoint,
  }: {
    baseUrl: string;
    authorizationHeader: string;
    sourcePayload: unknown;
    endpoint: SampledContractEndpointDefinition;
  }): Promise<DiscoveryDependencyCheck> {
    const sampleId = this.readFirstListItemId(sourcePayload);
    if (!sampleId) {
      return {
        key: endpoint.key,
        label: endpoint.label,
        status: 'ok',
        probeMode: 'skipped',
        detail: `Skipped sampled detail probe because ${endpoint.sourceKey} returned no items yet.`,
      };
    }

    const probe = await this.fetchJson(`${baseUrl}${endpoint.buildPath(sampleId)}`, {
      headers: {
        authorization: authorizationHeader,
      },
    });

    return {
      ...this.mapValidatedContractProbe(
        endpoint.key,
        endpoint.label,
        probe,
        (payload) => endpoint.validate(payload, sampleId)
      ),
      probeMode: 'sampled',
      sampledId: sampleId,
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

  private resolveDiscoveryServiceBaseUrl(apiBaseUrl: string): string {
    try {
      const url = new URL(apiBaseUrl);
      return `${url.protocol}//${url.host}`;
    } catch {
      return 'http://localhost:8000';
    }
  }

  private async fetchJson(
    url: string,
    options: RequestInit = {}
  ): Promise<HttpProbeResult> {
    const controller = new AbortController();
    const timeoutMs = Math.max(1000, Math.min(env.http.requestTimeoutMs, 5000));
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        ...options,
        method: options.method || 'GET',
        headers: {
          accept: 'application/json',
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });
      const latencyMs = Date.now() - startedAt;
      const text = await response.text();
      let payload: unknown = null;

      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text || null;
      }

      if (!response.ok) {
        return {
          ok: false,
          httpStatus: response.status,
          latencyMs,
          payload,
          detail: this.readHttpErrorDetail(payload, response.status),
        };
      }

      return {
        ok: true,
        httpStatus: response.status,
        latencyMs,
        payload,
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      return {
        ok: false,
        latencyMs,
        detail:
          error instanceof Error ? error.message : `Unexpected fetch failure: ${String(error)}`,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private mapServiceProbe(probe: HttpProbeResult): DiscoveryDependencyCheck {
    if (!probe.ok) {
      return {
        key: 'service',
        label: 'Discovery engine health',
        status: 'down',
        httpStatus: probe.httpStatus,
        latencyMs: probe.latencyMs,
        detail: probe.detail || 'Discovery engine /health probe failed.',
      };
    }

    const payload = this.asRecord(probe.payload);
    const service = String(payload.service || '').trim();
    const status = String(payload.status || '').trim().toLowerCase();
    const valid = service === 'discovery-engine' && status === 'ok';

    return {
      key: 'service',
      label: 'Discovery engine health',
      status: valid ? 'ok' : 'down',
      httpStatus: probe.httpStatus,
      latencyMs: probe.latencyMs,
      ...(valid
        ? {}
        : {
            detail: 'Discovery engine /health returned an unexpected payload.',
          }),
    };
  }

  private mapReadinessProbe(
    probe: HttpProbeResult
  ): DiscoveryDependencyCheck & {
    dependencies?: Record<string, DiscoveryDependencyReadinessDependency>;
  } {
    if (!probe.ok) {
      return {
        key: 'readiness',
        label: 'Discovery engine readiness',
        status: 'down',
        httpStatus: probe.httpStatus,
        latencyMs: probe.latencyMs,
        detail: probe.detail || 'Discovery engine /health/ready probe failed.',
      };
    }

    const payload = this.asRecord(probe.payload);
    const dependencies = this.normalizeReadinessDependencies(payload.dependencies);
    const status = String(payload.status || '').trim().toLowerCase();
    const dependencyStatuses = Object.values(dependencies);
    const validStatus = status === 'ok' || status === 'degraded';
    const derivedStatus =
      !validStatus
        ? 'down'
        : dependencyStatuses.some((item) => item.status !== 'ok') || status === 'degraded'
          ? 'degraded'
          : 'ok';

    return {
      key: 'readiness',
      label: 'Discovery engine readiness',
      status: derivedStatus,
      httpStatus: probe.httpStatus,
      latencyMs: probe.latencyMs,
      ...(Object.keys(dependencies).length ? { dependencies } : {}),
      ...(validStatus
        ? {}
        : {
            detail: 'Discovery engine /health/ready returned an unexpected payload.',
          }),
    };
  }

  private mapValidatedContractProbe(
    key: string,
    label: string,
    probe: HttpProbeResult,
    validator: (payload: unknown) => string | null
  ): DiscoveryDependencyCheck {
    if (!probe.ok) {
      return this.mapContractProbe(key, label, probe, `${label} probe failed.`);
    }

    const validationError = validator(probe.payload);
    return {
      key,
      label,
      status: validationError ? 'down' : 'ok',
      httpStatus: probe.httpStatus,
      latencyMs: probe.latencyMs,
      ...(validationError ? { detail: validationError } : {}),
    };
  }

  private mapContractProbe(
    key: string,
    label: string,
    probe: HttpProbeResult,
    fallbackDetail: string
  ): DiscoveryDependencyCheck {
    return {
      key,
      label,
      status: 'down',
      httpStatus: probe.httpStatus,
      latencyMs: probe.latencyMs,
      detail: probe.detail || fallbackDetail,
    };
  }

  private normalizeReadinessDependencies(
    value: unknown
  ): Record<string, DiscoveryDependencyReadinessDependency> {
    const parsed = this.asRecord(value);
    const normalized: Record<string, DiscoveryDependencyReadinessDependency> = {};

    for (const [key, item] of Object.entries(parsed)) {
      const record = this.asRecord(item);
      const status = String(record.status || '').trim().toLowerCase();
      normalized[key] = {
        status:
          status === 'ok' ? 'ok' : status === 'degraded' ? 'degraded' : 'down',
        ...(record.detail ? { detail: String(record.detail) } : {}),
      };
    }

    return normalized;
  }

  private readHttpErrorDetail(payload: unknown, status: number): string {
    const record = this.asRecord(payload);
    if (typeof record.detail === 'string' && record.detail.trim()) {
      return record.detail.trim();
    }
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim();
    }
    return `Request failed with HTTP ${status}`;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private readFirstListItemId(value: unknown): string {
    const payload = this.asRecord(value);
    const items = Array.isArray(payload.items) ? payload.items : [];
    for (const item of items) {
      const record = this.asRecord(item);
      const id = String(record.id || '').trim();
      if (id) {
        return id;
      }
    }
    return '';
  }

  private static validateListPayload(
    payload: unknown,
    _requiredKeys: string[]
  ): string | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return 'Expected an object payload with items and total.';
    }

    const record = payload as Record<string, unknown>;
    if (!Array.isArray(record.items)) {
      return 'Expected `items` to be an array.';
    }
    if (!Number.isFinite(Number(record.total))) {
      return 'Expected `total` to be a finite number.';
    }

    return null;
  }

  private static validatePreferencePayload(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return 'Expected a preference object payload.';
    }

    const record = payload as Record<string, unknown>;
    if (!Array.isArray(record.preferred_timeframes)) {
      return 'Expected `preferred_timeframes` to be an array.';
    }
    if (typeof record.risk_tolerance !== 'string' || !record.risk_tolerance.trim()) {
      return 'Expected `risk_tolerance` to be a non-empty string.';
    }
    if (typeof record.auto_backtest_approved !== 'boolean') {
      return 'Expected `auto_backtest_approved` to be a boolean.';
    }

    return null;
  }

  private static validateBotDetailPayload(
    payload: unknown,
    sampleId: string
  ): string | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return 'Expected a bot detail object payload.';
    }

    const record = payload as Record<string, unknown>;
    if (String(record.id || '').trim() !== sampleId) {
      return 'Expected bot detail payload to include the sampled id.';
    }
    if (typeof record.name !== 'string' || !record.name.trim()) {
      return 'Expected `name` to be a non-empty string.';
    }
    if (typeof record.status !== 'string' || !record.status.trim()) {
      return 'Expected `status` to be a non-empty string.';
    }

    return null;
  }

  private static validateRunDetailPayload(
    payload: unknown,
    sampleId: string
  ): string | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return 'Expected a run detail object payload.';
    }

    const record = payload as Record<string, unknown>;
    if (String(record.id || '').trim() !== sampleId) {
      return 'Expected run detail payload to include the sampled id.';
    }
    if (typeof record.status !== 'string' || !record.status.trim()) {
      return 'Expected `status` to be a non-empty string.';
    }

    return null;
  }

  private static validateStrategyDetailPayload(
    payload: unknown,
    sampleId: string
  ): string | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return 'Expected a strategy detail object payload.';
    }

    const record = payload as Record<string, unknown>;
    if (String(record.id || '').trim() !== sampleId) {
      return 'Expected strategy detail payload to include the sampled id.';
    }
    if (typeof record.name !== 'string' || !record.name.trim()) {
      return 'Expected `name` to be a non-empty string.';
    }
    if (typeof record.status !== 'string' || !record.status.trim()) {
      return 'Expected `status` to be a non-empty string.';
    }

    return null;
  }
}
