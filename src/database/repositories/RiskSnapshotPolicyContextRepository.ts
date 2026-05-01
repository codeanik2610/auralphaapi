import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { RiskSnapshotPolicyContext } from '../entities/RiskSnapshotPolicyContext';

export interface ComputedRiskSnapshotPolicyContextPayload {
  contextKey: string;
  policyId: string | null;
  policyScope: string;
  policyTargetKey: string;
  enabled: boolean;
  monitorOnly: boolean;
  enforceHardBlock: boolean;
  marginUsageWarnPct: number;
  marginUsageCriticalPct: number;
  concentrationWarnPct: number;
  concentrationCriticalPct: number;
  dailyLossLimitPct: number;
  weeklyLossLimitPct: number;
  monthlyLossLimitPct: number;
  minLeverage: number | null;
  maxLeverage: number | null;
  tradeSizePctOfBalance: number | null;
  minNotionalPerTrade: number | null;
  maxOrderAllocation: number | null;
  maxTotalAllocation: number | null;
  maxAvgLeverage: number | null;
}

@Service()
export class RiskSnapshotPolicyContextRepository {
  private get policyContextRepository(): Repository<RiskSnapshotPolicyContext> {
    return coreDataSource.getRepository(RiskSnapshotPolicyContext);
  }

  async createComputedPolicyContexts(
    userId: string,
    snapshotId: string,
    payloads: ComputedRiskSnapshotPolicyContextPayload[]
  ): Promise<RiskSnapshotPolicyContext[]> {
    if (!payloads.length) {
      return [];
    }

    const created = this.policyContextRepository.create(
      payloads.map((payload) => ({
        snapshotId,
        userId,
        contextKey: payload.contextKey,
        policyId: payload.policyId,
        policyScope: payload.policyScope,
        policyTargetKey: payload.policyTargetKey,
        enabled: payload.enabled,
        monitorOnly: payload.monitorOnly,
        enforceHardBlock: payload.enforceHardBlock,
        marginUsageWarnPct: payload.marginUsageWarnPct,
        marginUsageCriticalPct: payload.marginUsageCriticalPct,
        concentrationWarnPct: payload.concentrationWarnPct,
        concentrationCriticalPct: payload.concentrationCriticalPct,
        dailyLossLimitPct: payload.dailyLossLimitPct,
        weeklyLossLimitPct: payload.weeklyLossLimitPct,
        monthlyLossLimitPct: payload.monthlyLossLimitPct,
        minLeverage: payload.minLeverage,
        maxLeverage: payload.maxLeverage,
        tradeSizePctOfBalance: payload.tradeSizePctOfBalance,
        minNotionalPerTrade: payload.minNotionalPerTrade,
        maxOrderAllocation: payload.maxOrderAllocation,
        maxTotalAllocation: payload.maxTotalAllocation,
        maxAvgLeverage: payload.maxAvgLeverage,
      }))
    );

    return this.policyContextRepository.save(created);
  }

  async listBySnapshotId(snapshotId: string): Promise<RiskSnapshotPolicyContext[]> {
    const normalizedSnapshotId = String(snapshotId || '').trim();
    if (!normalizedSnapshotId) {
      return [];
    }

    return this.policyContextRepository.find({
      where: {
        snapshotId: normalizedSnapshotId,
      },
      order: {
        policyScope: 'ASC',
        policyTargetKey: 'ASC',
        contextKey: 'ASC',
      },
    });
  }
}
