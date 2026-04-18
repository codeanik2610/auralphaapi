import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { RiskRuleEvaluation } from '../entities/RiskRuleEvaluation';

export interface RiskRuleEvaluationQuery {
  limit: number;
  offset: number;
  status?: string;
  scope?: string;
}

export interface ComputedRiskRuleEvaluationPayload {
  policyContextKey?: string | null;
  policyContextId?: string | null;
  sourceType: string;
  scopeType: string;
  scopeKey: string;
  scopeLabel?: string | null;
  brokerKey?: string | null;
  accountId?: string | null;
  positionId?: string | null;
  symbol?: string | null;
  ruleCode: string;
  metricName?: string | null;
  actualValue?: number | null;
  basisValue?: number | null;
  warnThresholdValue?: number | null;
  criticalThresholdValue?: number | null;
  status: string;
  bucket?: string | null;
  exposure?: string | null;
  threshold?: string | null;
  action?: string | null;
  alertSeverity?: string | null;
  alertMessage?: string | null;
  alertSymbol?: string | null;
  alertChannel?: string | null;
  alertStatus?: string | null;
  sortOrder?: number;
}

@Service()
export class RiskRuleEvaluationRepository {
  private get ruleEvaluationRepository(): Repository<RiskRuleEvaluation> {
    return coreDataSource.getRepository(RiskRuleEvaluation);
  }

  async createComputedRuleEvaluations(
    userId: string,
    snapshotId: string,
    payloads: ComputedRiskRuleEvaluationPayload[]
  ): Promise<number> {
    if (!payloads.length) {
      return 0;
    }

    const created = this.ruleEvaluationRepository.create(
      payloads
        .filter(
          (payload) =>
            String(payload.sourceType || '').trim() &&
            String(payload.scopeType || '').trim() &&
            String(payload.scopeKey || '').trim() &&
            String(payload.ruleCode || '').trim() &&
            String(payload.status || '').trim()
        )
        .map((payload, index) => ({
          snapshotId,
          userId,
          policyContextId: payload.policyContextId ?? null,
          sourceType: String(payload.sourceType || '').trim(),
          scopeType: String(payload.scopeType || '').trim(),
          scopeKey: String(payload.scopeKey || '').trim(),
          scopeLabel: payload.scopeLabel ? String(payload.scopeLabel).trim() : null,
          brokerKey: payload.brokerKey ? String(payload.brokerKey).trim() : null,
          accountId: payload.accountId ? String(payload.accountId).trim() : null,
          positionId: payload.positionId ? String(payload.positionId).trim() : null,
          symbol: payload.symbol ? String(payload.symbol).trim() : null,
          ruleCode: String(payload.ruleCode || '').trim(),
          metricName: payload.metricName ? String(payload.metricName).trim() : null,
          actualValue: payload.actualValue ?? null,
          basisValue: payload.basisValue ?? null,
          warnThresholdValue: payload.warnThresholdValue ?? null,
          criticalThresholdValue: payload.criticalThresholdValue ?? null,
          status: String(payload.status || '').trim(),
          bucket: payload.bucket ? String(payload.bucket).trim() : null,
          exposure: payload.exposure ? String(payload.exposure).trim() : null,
          threshold: payload.threshold ? String(payload.threshold).trim() : null,
          action: payload.action ? String(payload.action).trim() : null,
          alertSeverity: payload.alertSeverity ? String(payload.alertSeverity).trim() : null,
          alertMessage: payload.alertMessage ? String(payload.alertMessage).trim() : null,
          alertSymbol: payload.alertSymbol ? String(payload.alertSymbol).trim() : null,
          alertChannel: payload.alertChannel ? String(payload.alertChannel).trim() : null,
          alertStatus: payload.alertStatus ? String(payload.alertStatus).trim() : null,
          sortOrder: Math.max(0, Math.trunc(payload.sortOrder ?? index)),
        }))
    );

    await this.ruleEvaluationRepository.save(created);
    return created.length;
  }

  async listBySnapshotId(snapshotId: string): Promise<RiskRuleEvaluation[]> {
    const normalizedSnapshotId = String(snapshotId || '').trim();
    if (!normalizedSnapshotId) {
      return [];
    }

    return this.ruleEvaluationRepository.find({
      where: {
        snapshotId: normalizedSnapshotId,
      },
      order: {
        sortOrder: 'ASC',
        createdAt: 'DESC',
        id: 'ASC',
      },
    });
  }

  async listRiskControls(
    userId: string,
    query: RiskRuleEvaluationQuery
  ): Promise<{
    items: RiskRuleEvaluation[];
    total: number;
  }> {
    const builder = this.ruleEvaluationRepository
      .createQueryBuilder('evaluation')
      .where('evaluation.userId = :userId', { userId })
      .andWhere('evaluation.sourceType = :sourceType', { sourceType: 'control' });

    if (query.status) {
      builder.andWhere('LOWER(evaluation.status) = :status', {
        status: query.status.trim().toLowerCase(),
      });
    }
    if (query.scope) {
      builder.andWhere('LOWER(evaluation.bucket) = :scope', {
        scope: query.scope.trim().toLowerCase(),
      });
    }

    const total = await builder.getCount();
    const items = await builder
      .orderBy('evaluation.createdAt', 'DESC')
      .addOrderBy('evaluation.sortOrder', 'ASC')
      .addOrderBy('evaluation.id', 'ASC')
      .limit(query.limit)
      .offset(query.offset)
      .getMany();

    return {
      items,
      total,
    };
  }

  async listRiskAlerts(
    userId: string,
    query: RiskRuleEvaluationQuery
  ): Promise<{
    items: RiskRuleEvaluation[];
    total: number;
  }> {
    const builder = this.ruleEvaluationRepository
      .createQueryBuilder('evaluation')
      .where('evaluation.userId = :userId', { userId })
      .andWhere('evaluation.alertSeverity IS NOT NULL')
      .andWhere("TRIM(COALESCE(evaluation.alertMessage, '')) <> ''");

    if (query.status) {
      builder.andWhere('LOWER(evaluation.alertStatus) = :status', {
        status: query.status.trim().toLowerCase(),
      });
    }
    if (query.scope) {
      builder.andWhere('LOWER(evaluation.alertChannel) = :scope', {
        scope: query.scope.trim().toLowerCase(),
      });
    }

    const total = await builder.getCount();
    const items = await builder
      .orderBy('evaluation.createdAt', 'DESC')
      .addOrderBy('evaluation.sortOrder', 'ASC')
      .addOrderBy('evaluation.id', 'ASC')
      .limit(query.limit)
      .offset(query.offset)
      .getMany();

    return {
      items,
      total,
    };
  }

  async getRiskAlertsSummary(
    userId: string,
    query: RiskRuleEvaluationQuery
  ): Promise<{
    total: number;
    bySeverity: Record<string, number>;
    byStatus: Record<string, number>;
  }> {
    const builder = this.ruleEvaluationRepository
      .createQueryBuilder('evaluation')
      .where('evaluation.userId = :userId', { userId })
      .andWhere('evaluation.alertSeverity IS NOT NULL')
      .andWhere("TRIM(COALESCE(evaluation.alertMessage, '')) <> ''");

    if (query.status) {
      builder.andWhere('LOWER(evaluation.alertStatus) = :status', {
        status: query.status.trim().toLowerCase(),
      });
    }
    if (query.scope) {
      builder.andWhere('LOWER(evaluation.alertChannel) = :scope', {
        scope: query.scope.trim().toLowerCase(),
      });
    }

    const [total, severityRows, statusRows] = await Promise.all([
      builder.getCount(),
      builder
        .clone()
        .select('evaluation.alertSeverity', 'severity')
        .addSelect('COUNT(*)', 'total')
        .groupBy('evaluation.alertSeverity')
        .getRawMany(),
      builder
        .clone()
        .select('evaluation.alertStatus', 'status')
        .addSelect('COUNT(*)', 'total')
        .groupBy('evaluation.alertStatus')
        .getRawMany(),
    ]);

    const bySeverity = (severityRows || []).reduce((acc: Record<string, number>, row: { severity?: unknown; total?: unknown }) => {
      const key = String(row?.severity || '').trim();
      if (!key) {
        return acc;
      }
      acc[key] = Number(row?.total || 0);
      return acc;
    }, {});

    const byStatus = (statusRows || []).reduce((acc: Record<string, number>, row: { status?: unknown; total?: unknown }) => {
      const key = String(row?.status || '').trim();
      if (!key) {
        return acc;
      }
      acc[key] = Number(row?.total || 0);
      return acc;
    }, {});

    return {
      total,
      bySeverity,
      byStatus,
    };
  }

  async getLatestControlCreatedAtForUsers(userIds: string[]): Promise<Date | null> {
    return this.getLatestCreatedAtForUsersInternal(userIds, {
      sourceType: 'control',
    });
  }

  async getLatestCreatedAtForUsers(userIds: string[]): Promise<Date | null> {
    return this.getLatestCreatedAtForUsersInternal(userIds);
  }

  async getLatestAlertCreatedAtForUsers(userIds: string[]): Promise<Date | null> {
    return this.getLatestCreatedAtForUsersInternal(userIds, {
      requireAlert: true,
    });
  }

  private async getLatestCreatedAtForUsersInternal(
    userIds: string[],
    options: {
      sourceType?: string;
      requireAlert?: boolean;
    } = {}
  ): Promise<Date | null> {
    const normalizedUserIds = Array.from(
      new Set(userIds.map((item) => String(item || '').trim()).filter(Boolean))
    );
    if (!normalizedUserIds.length) {
      return null;
    }

    const builder = this.ruleEvaluationRepository
      .createQueryBuilder('evaluation')
      .select('MAX(evaluation.createdAt)', 'latestCreatedAt')
      .where('evaluation.userId IN (:...userIds)', { userIds: normalizedUserIds });

    if (options.sourceType) {
      builder.andWhere('evaluation.sourceType = :sourceType', {
        sourceType: options.sourceType,
      });
    }
    if (options.requireAlert) {
      builder.andWhere('evaluation.alertSeverity IS NOT NULL');
      builder.andWhere("TRIM(COALESCE(evaluation.alertMessage, '')) <> ''");
    }

    const row = await builder.getRawOne<{ latestCreatedAt?: Date | string | null }>();
    const value = row?.latestCreatedAt;
    const date = value instanceof Date ? value : value ? new Date(String(value)) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }
}
