import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { RiskRequestScopeImpact } from '../entities/RiskRequestScopeImpact';

export interface CreateRiskRequestScopeImpactPayload {
  scopeType: string;
  scopeKey: string;
  scopeLabel?: string | null;
  brokerKey?: string | null;
  accountId?: string | null;
  symbol?: string | null;
  beforeGrossExposure?: number | null;
  beforeNetExposure?: number | null;
  beforeOpenOrderExposure?: number | null;
  beforeReservedOrderMargin?: number | null;
  beforeMarginUsagePct?: number | null;
  beforeAllocationPct?: number | null;
  beforeRiskScore?: number | null;
  beforeRiskState?: string | null;
  deltaGrossExposure?: number | null;
  deltaNetExposure?: number | null;
  deltaOpenOrderExposure?: number | null;
  deltaReservedOrderMargin?: number | null;
  afterGrossExposure?: number | null;
  afterNetExposure?: number | null;
  afterOpenOrderExposure?: number | null;
  afterReservedOrderMargin?: number | null;
  afterMarginUsagePct?: number | null;
  afterAllocationPct?: number | null;
  afterRiskScore?: number | null;
  afterRiskState?: string | null;
  sortOrder?: number;
}

@Service()
export class RiskRequestScopeImpactRepository {
  private get repository(): Repository<RiskRequestScopeImpact> {
    return coreDataSource.getRepository(RiskRequestScopeImpact);
  }

  async createScopeImpacts(
    userId: string,
    checkId: string,
    snapshotId: string | null,
    payloads: CreateRiskRequestScopeImpactPayload[]
  ): Promise<RiskRequestScopeImpact[]> {
    if (!payloads.length) {
      return [];
    }

    const created = this.repository.create(
      payloads.map((payload, index) => ({
        checkId,
        userId,
        snapshotId,
        scopeType: String(payload.scopeType || '').trim(),
        scopeKey: String(payload.scopeKey || '').trim(),
        scopeLabel: payload.scopeLabel ? String(payload.scopeLabel).trim() : null,
        brokerKey: payload.brokerKey ? String(payload.brokerKey).trim().toLowerCase() : null,
        accountId: payload.accountId ? String(payload.accountId).trim() : null,
        symbol: payload.symbol ? String(payload.symbol).trim().toUpperCase() : null,
        beforeGrossExposure: payload.beforeGrossExposure ?? null,
        beforeNetExposure: payload.beforeNetExposure ?? null,
        beforeOpenOrderExposure: payload.beforeOpenOrderExposure ?? null,
        beforeReservedOrderMargin: payload.beforeReservedOrderMargin ?? null,
        beforeMarginUsagePct: payload.beforeMarginUsagePct ?? null,
        beforeAllocationPct: payload.beforeAllocationPct ?? null,
        beforeRiskScore: payload.beforeRiskScore ?? null,
        beforeRiskState: payload.beforeRiskState ? String(payload.beforeRiskState).trim() : null,
        deltaGrossExposure: payload.deltaGrossExposure ?? null,
        deltaNetExposure: payload.deltaNetExposure ?? null,
        deltaOpenOrderExposure: payload.deltaOpenOrderExposure ?? null,
        deltaReservedOrderMargin: payload.deltaReservedOrderMargin ?? null,
        afterGrossExposure: payload.afterGrossExposure ?? null,
        afterNetExposure: payload.afterNetExposure ?? null,
        afterOpenOrderExposure: payload.afterOpenOrderExposure ?? null,
        afterReservedOrderMargin: payload.afterReservedOrderMargin ?? null,
        afterMarginUsagePct: payload.afterMarginUsagePct ?? null,
        afterAllocationPct: payload.afterAllocationPct ?? null,
        afterRiskScore: payload.afterRiskScore ?? null,
        afterRiskState: payload.afterRiskState ? String(payload.afterRiskState).trim() : null,
        sortOrder: Math.max(0, Math.trunc(payload.sortOrder ?? index)),
      }))
    );

    return this.repository.save(created);
  }

  async listByCheckId(checkId: string): Promise<RiskRequestScopeImpact[]> {
    const normalizedCheckId = String(checkId || '').trim();
    if (!normalizedCheckId) {
      return [];
    }

    return this.repository.find({
      where: {
        checkId: normalizedCheckId,
      },
      order: {
        sortOrder: 'ASC',
        createdAt: 'ASC',
        id: 'ASC',
      },
    });
  }
}
