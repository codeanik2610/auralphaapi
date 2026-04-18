import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { RiskRequestRuleEvaluation } from '../entities/RiskRequestRuleEvaluation';

export interface CreateRiskRequestRuleEvaluationPayload {
  policyContextId?: string | null;
  scopeType: string;
  scopeKey: string;
  scopeLabel?: string | null;
  brokerKey?: string | null;
  accountId?: string | null;
  symbol?: string | null;
  ruleCode: string;
  metricName?: string | null;
  actualValue?: number | null;
  basisValue?: number | null;
  warnThresholdValue?: number | null;
  criticalThresholdValue?: number | null;
  status: string;
  blocking: boolean;
  message: string;
  sortOrder?: number;
}

@Service()
export class RiskRequestRuleEvaluationRepository {
  private get repository(): Repository<RiskRequestRuleEvaluation> {
    return coreDataSource.getRepository(RiskRequestRuleEvaluation);
  }

  async createRuleEvaluations(
    userId: string,
    checkId: string,
    snapshotId: string | null,
    payloads: CreateRiskRequestRuleEvaluationPayload[]
  ): Promise<RiskRequestRuleEvaluation[]> {
    if (!payloads.length) {
      return [];
    }

    const created = this.repository.create(
      payloads.map((payload, index) => ({
        checkId,
        userId,
        snapshotId,
        policyContextId: payload.policyContextId ?? null,
        scopeType: String(payload.scopeType || '').trim(),
        scopeKey: String(payload.scopeKey || '').trim(),
        scopeLabel: payload.scopeLabel ? String(payload.scopeLabel).trim() : null,
        brokerKey: payload.brokerKey ? String(payload.brokerKey).trim().toLowerCase() : null,
        accountId: payload.accountId ? String(payload.accountId).trim() : null,
        symbol: payload.symbol ? String(payload.symbol).trim().toUpperCase() : null,
        ruleCode: String(payload.ruleCode || '').trim(),
        metricName: payload.metricName ? String(payload.metricName).trim() : null,
        actualValue: payload.actualValue ?? null,
        basisValue: payload.basisValue ?? null,
        warnThresholdValue: payload.warnThresholdValue ?? null,
        criticalThresholdValue: payload.criticalThresholdValue ?? null,
        status: String(payload.status || '').trim().toLowerCase(),
        blocking: Boolean(payload.blocking),
        message: String(payload.message || '').trim(),
        sortOrder: Math.max(0, Math.trunc(payload.sortOrder ?? index)),
      }))
    );

    return this.repository.save(created);
  }

  async listByCheckId(checkId: string): Promise<RiskRequestRuleEvaluation[]> {
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
