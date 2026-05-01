import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { RiskKillSwitchState } from '../entities/RiskKillSwitchState';

export interface RiskKillSwitchTarget {
  scope: string;
  brokerKey?: string | null;
  accountId?: string | null;
}

export interface TriggerRiskKillSwitchPayload extends RiskKillSwitchTarget {
  reason: string;
  triggeredBy: string;
}

export interface ClearRiskKillSwitchPayload extends RiskKillSwitchTarget {
  clearedBy: string;
}

@Service()
export class RiskKillSwitchRepository {
  private get repository(): Repository<RiskKillSwitchState> {
    return coreDataSource.getRepository(RiskKillSwitchState);
  }

  async trigger(
    userId: string,
    payload: TriggerRiskKillSwitchPayload
  ): Promise<RiskKillSwitchState> {
    await this.clearActive(userId, {
      scope: payload.scope,
      brokerKey: payload.brokerKey,
      accountId: payload.accountId,
      clearedBy: payload.triggeredBy,
    });

    const now = new Date();
    const created = this.repository.create({
      userId,
      scope: payload.scope,
      brokerKey: this.normalizeOptional(payload.brokerKey),
      accountId: this.normalizeOptional(payload.accountId),
      active: true,
      reason: payload.reason,
      triggeredBy: payload.triggeredBy,
      triggeredAt: now,
      clearedBy: null,
      clearedAt: null,
    });
    return this.repository.save(created);
  }

  async clearActive(userId: string, payload: ClearRiskKillSwitchPayload): Promise<number> {
    const query = this.repository
      .createQueryBuilder()
      .update(RiskKillSwitchState)
      .set({
        active: false,
        clearedBy: payload.clearedBy,
        clearedAt: new Date(),
      })
      .where('user_id = :userId', { userId })
      .andWhere('active = :active', { active: true })
      .andWhere('scope = :scope', { scope: payload.scope });

    const brokerKey = this.normalizeOptional(payload.brokerKey);
    const accountId = this.normalizeOptional(payload.accountId);
    if (brokerKey) {
      query.andWhere('LOWER(TRIM(COALESCE(broker_key, ""))) = :brokerKey', {
        brokerKey,
      });
    }
    if (accountId) {
      query.andWhere('account_id = :accountId', { accountId });
    }

    const result = await query.execute();
    return result.affected ?? 0;
  }

  async listActive(userId: string): Promise<RiskKillSwitchState[]> {
    return this.repository.find({
      where: { userId, active: true },
      order: { triggeredAt: 'DESC' },
    });
  }

  async findActiveBlock(
    userId: string,
    context: { brokerKey?: string | null; accountId?: string | null } = {}
  ): Promise<RiskKillSwitchState | null> {
    const active = await this.listActive(userId);
    const brokerKey = this.normalizeOptional(context.brokerKey);
    const accountId = this.normalizeOptional(context.accountId);

    return (
      active.find((item) => ['workspace', 'user', 'global'].includes(item.scope)) ??
      active.find((item) => {
        if (item.scope !== 'broker') {
          return false;
        }
        const itemBrokerKey = this.normalizeOptional(item.brokerKey);
        const itemAccountId = this.normalizeOptional(item.accountId);
        return (
          Boolean(brokerKey && itemBrokerKey === brokerKey) &&
          (!itemAccountId || !accountId || itemAccountId === accountId)
        );
      }) ??
      null
    );
  }

  private normalizeOptional(value: string | null | undefined): string | null {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    return normalized || null;
  }
}
