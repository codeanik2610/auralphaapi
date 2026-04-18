import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { RiskRequestCheck } from '../entities/RiskRequestCheck';

export interface CreateRiskRequestCheckPayload {
  userId: string;
  snapshotId?: string | null;
  suggestedTradeId?: string | null;
  automationId?: string | null;
  automationRunId?: string | null;
  sourceType: string;
  executionMode: string;
  approvalMode: string;
  routeMode: string;
  brokerKey?: string | null;
  accountId?: string | null;
  symbol: string;
  timeframe?: string | null;
  side: string;
  orderType: string;
  timeInForce?: string | null;
  quantityMode: string;
  quantity?: number | null;
  notional?: number | null;
  riskPercent?: number | null;
  entryPrice?: number | null;
  stopLossPrice?: number | null;
  takeProfitTargetsJson?: number[] | null;
  leverage?: number | null;
  reduceOnly: boolean;
  status: string;
  freshnessState: string;
  snapshotLagMinutes?: number | null;
  checkedAt: Date;
  expiresAt?: Date | null;
  allowed: boolean;
  blocked: boolean;
  approvalRequired: boolean;
  blockingRuleCount: number;
  warningRuleCount: number;
  summary: string;
  grossExposureDelta?: number | null;
  netExposureDelta?: number | null;
  openOrderExposureDelta?: number | null;
  reservedOrderMarginDelta?: number | null;
}

@Service()
export class RiskRequestCheckRepository {
  private get repository(): Repository<RiskRequestCheck> {
    return coreDataSource.getRepository(RiskRequestCheck);
  }

  async createCheck(payload: CreateRiskRequestCheckPayload): Promise<RiskRequestCheck> {
    const created = this.repository.create({
      ...payload,
      takeProfitTargetsJson: payload.takeProfitTargetsJson ?? null,
    });
    return this.repository.save(created);
  }

  async getById(userId: string, checkId: string): Promise<RiskRequestCheck | null> {
    const normalizedUserId = String(userId || '').trim();
    const normalizedCheckId = String(checkId || '').trim();
    if (!normalizedUserId || !normalizedCheckId) {
      return null;
    }

    return this.repository.findOne({
      where: {
        id: normalizedCheckId,
        userId: normalizedUserId,
      },
    });
  }
}
