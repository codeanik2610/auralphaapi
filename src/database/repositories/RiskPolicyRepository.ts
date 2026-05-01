import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { RiskPolicy } from '../entities/RiskPolicy';
import { RiskPolicyVersion } from '../entities/RiskPolicyVersion';

export interface UpsertRiskPolicyPayload {
  scope: 'user' | 'broker';
  brokerKey?: string;
  enabled: boolean;
  monitorOnly: boolean;
  enforceHardBlock: boolean;
  marginUsageWarnPct: number;
  marginUsageCriticalPct: number;
  concentrationWarnPct: number;
  concentrationCriticalPct: number;
  dailyLossLimitPct?: number;
  weeklyLossLimitPct?: number;
  monthlyLossLimitPct?: number;
  minLeverage?: number;
  maxLeverage?: number;
  tradeSizePctOfBalance?: number;
  minNotionalPerTrade?: number;
  maxOrderAllocation?: number;
  maxTotalAllocation?: number;
  maxAvgLeverage?: number;
}

@Service()
export class RiskPolicyRepository {
  private readonly duplicateTargetIndexName = 'uidx_risk_policies_user_target_key';

  private get riskPolicyRepository(): Repository<RiskPolicy> {
    return coreDataSource.getRepository(RiskPolicy);
  }

  private get riskPolicyVersionRepository(): Repository<RiskPolicyVersion> {
    return coreDataSource.getRepository(RiskPolicyVersion);
  }

  async listPolicies(userId: string): Promise<RiskPolicy[]> {
    return this.riskPolicyRepository.find({
      where: { userId },
      order: {
        updatedAt: 'DESC',
      },
    });
  }

  async getPolicyById(userId: string, id: string): Promise<RiskPolicy | null> {
    return this.riskPolicyRepository.findOne({ where: { id, userId } });
  }

  async createPolicy(userId: string, payload: UpsertRiskPolicyPayload): Promise<RiskPolicy> {
    const created = this.riskPolicyRepository.create({
      userId,
      scope: payload.scope,
      brokerKey:
        payload.scope === 'broker' ? this.normalizeBrokerKey(payload.brokerKey) : null,
      accountId: null,
      enabled: payload.enabled,
      monitorOnly: payload.monitorOnly,
      enforceHardBlock: payload.enforceHardBlock,
      marginUsageWarnPct: payload.marginUsageWarnPct,
      marginUsageCriticalPct: payload.marginUsageCriticalPct,
      concentrationWarnPct: payload.concentrationWarnPct,
      concentrationCriticalPct: payload.concentrationCriticalPct,
      dailyLossLimitPct: payload.dailyLossLimitPct ?? undefined,
      weeklyLossLimitPct: payload.weeklyLossLimitPct ?? undefined,
      monthlyLossLimitPct: payload.monthlyLossLimitPct ?? undefined,
      minLeverage: payload.minLeverage ?? null,
      maxLeverage: payload.maxLeverage ?? null,
      tradeSizePctOfBalance: payload.tradeSizePctOfBalance ?? null,
      minNotionalPerTrade: payload.minNotionalPerTrade ?? null,
      maxOrderAllocation: payload.maxOrderAllocation ?? null,
      maxTotalAllocation: payload.maxTotalAllocation ?? null,
      maxAvgLeverage: payload.maxAvgLeverage ?? null,
    } as Partial<RiskPolicy>);
    return this.riskPolicyRepository.save(created);
  }

  async updatePolicy(
    userId: string,
    id: string,
    payload: UpsertRiskPolicyPayload
  ): Promise<RiskPolicy | null> {
    const existing = await this.getPolicyById(userId, id);
    if (!existing) {
      return null;
    }
    await this.riskPolicyRepository.update(
      { id: existing.id, userId },
      {
        scope: payload.scope,
        brokerKey:
          payload.scope === 'broker' ? this.normalizeBrokerKey(payload.brokerKey) : null,
        accountId: null,
        enabled: payload.enabled,
        monitorOnly: payload.monitorOnly,
        enforceHardBlock: payload.enforceHardBlock,
        marginUsageWarnPct: payload.marginUsageWarnPct,
        marginUsageCriticalPct: payload.marginUsageCriticalPct,
        concentrationWarnPct: payload.concentrationWarnPct,
        concentrationCriticalPct: payload.concentrationCriticalPct,
        dailyLossLimitPct: payload.dailyLossLimitPct ?? undefined,
        weeklyLossLimitPct: payload.weeklyLossLimitPct ?? undefined,
        monthlyLossLimitPct: payload.monthlyLossLimitPct ?? undefined,
        minLeverage: payload.minLeverage ?? null,
        maxLeverage: payload.maxLeverage ?? null,
        tradeSizePctOfBalance: payload.tradeSizePctOfBalance ?? null,
        minNotionalPerTrade: payload.minNotionalPerTrade ?? null,
        maxOrderAllocation: payload.maxOrderAllocation ?? null,
        maxTotalAllocation: payload.maxTotalAllocation ?? null,
        maxAvgLeverage: payload.maxAvgLeverage ?? null,
      }
    );
    return this.getPolicyById(userId, id);
  }

  async findConflictingPolicy(
    userId: string,
    payload: Pick<UpsertRiskPolicyPayload, 'scope' | 'brokerKey'>,
    excludePolicyId?: string
  ): Promise<RiskPolicy | null> {
    const query = this.riskPolicyRepository
      .createQueryBuilder('policy')
      .where('policy.user_id = :userId', { userId });

    if (payload.scope === 'user') {
      query.andWhere('policy.scope = :scope', { scope: 'user' });
    } else {
      query
        .andWhere('policy.scope = :scope', { scope: 'broker' })
        .andWhere("LOWER(TRIM(COALESCE(policy.broker_key, ''))) = :brokerKey", {
          brokerKey: this.normalizeBrokerKey(payload.brokerKey) ?? '',
        });
    }

    if (excludePolicyId) {
      query.andWhere('policy.id <> :excludePolicyId', { excludePolicyId });
    }

    return query.orderBy('policy.updated_at', 'DESC').getOne();
  }

  async getEffectivePolicy(userId: string, brokerKey?: string | null): Promise<RiskPolicy | null> {
    const policies = await this.listPolicies(userId);
    const normalizedBrokerKey = this.normalizeBrokerKey(brokerKey);

    if (normalizedBrokerKey) {
      const brokerPolicy = policies.find(
        (policy) =>
          policy.enabled &&
          policy.scope === 'broker' &&
          this.normalizeBrokerKey(policy.brokerKey) === normalizedBrokerKey
      );

      if (brokerPolicy) {
        return brokerPolicy;
      }
    }

    return policies.find((policy) => policy.enabled && policy.scope === 'user') ?? null;
  }

  isDuplicatePolicyTargetError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const code = String((error as { code?: string }).code || '').trim();
    if (code !== 'ER_DUP_ENTRY' && code !== '23505') {
      return false;
    }

    const message = String((error as { message?: string }).message || '').toLowerCase();
    const constraint = String((error as { constraint?: string }).constraint || '').toLowerCase();
    const marker = this.duplicateTargetIndexName.toLowerCase();

    return message.includes(marker) || constraint.includes(marker);
  }

  async createPolicyVersion(
    policyId: string,
    userId: string,
    actorUserId: string,
    versionPayload: Record<string, unknown>
  ): Promise<RiskPolicyVersion> {
    const entry = this.riskPolicyVersionRepository.create({
      policyId,
      userId,
      actorUserId,
      versionPayload: JSON.stringify(versionPayload),
    });
    return this.riskPolicyVersionRepository.save(entry);
  }

  async listPolicyVersions(userId: string, policyId: string): Promise<RiskPolicyVersion[]> {
    return this.riskPolicyVersionRepository.find({
      where: { userId, policyId },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async getPolicyVersionById(
    userId: string,
    policyId: string,
    versionId: string
  ): Promise<RiskPolicyVersion | null> {
    return this.riskPolicyVersionRepository.findOne({
      where: {
        id: versionId,
        userId,
        policyId,
      },
    });
  }

  async updatePolicyVersionPayload(
    userId: string,
    policyId: string,
    versionId: string,
    versionPayload: Record<string, unknown>
  ): Promise<RiskPolicyVersion | null> {
    await this.riskPolicyVersionRepository.update(
      { id: versionId, userId, policyId },
      { versionPayload: JSON.stringify(versionPayload) }
    );

    return this.getPolicyVersionById(userId, policyId, versionId);
  }

  private normalizeBrokerKey(brokerKey?: string | null): string | null {
    const normalized = String(brokerKey || '')
      .trim()
      .toLowerCase();
    return normalized || null;
  }
}
