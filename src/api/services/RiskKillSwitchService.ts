import { Inject, Service } from 'typedi';
import {
  RiskKillSwitchBody,
  RiskKillSwitchResult,
  RiskKillSwitchStateItem,
  RiskKillSwitchStatusResult,
} from '../contracts/Risk';
import { BadRequestAppError } from '../errors/AppError';
import { buildApiTimeContract } from '../utils/apiTimeContract';
import {
  validateRiskKillSwitchBody,
  validateRiskKillSwitchClearBody,
} from '../validators/risk.validator';
import { RiskKillSwitchRepository } from '../../database/repositories/RiskKillSwitchRepository';
import { RiskKillSwitchState } from '../../database/entities/RiskKillSwitchState';
import { UserTimeZoneService } from './UserTimeZoneService';
import { OperationalEventService } from './OperationalEventService';

@Service()
export class RiskKillSwitchService {
  @Inject(() => RiskKillSwitchRepository)
  private riskKillSwitchRepository!: RiskKillSwitchRepository;

  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  async getStatus(userId: string): Promise<RiskKillSwitchStatusResult> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const activeStates = await this.riskKillSwitchRepository.listActive(userId);
    return {
      active: activeStates.length > 0,
      message: activeStates.length ? 'Risk kill switch is active' : 'Risk kill switch is inactive',
      items: activeStates.map((item) => this.mapState(item)),
      time: buildApiTimeContract(timeZone),
    };
  }

  async trigger(userId: string, body: RiskKillSwitchBody): Promise<RiskKillSwitchResult> {
    const validated = validateRiskKillSwitchBody(body);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);

    try {
      const state = await this.riskKillSwitchRepository.trigger(userId, {
        scope: validated.scope,
        brokerKey: validated.brokerKey,
        accountId: validated.accountId,
        reason: validated.reason,
        triggeredBy: userId,
      });

      await this.operationalEventService.logActivity(userId, {
        type: 'Risk control',
        title: 'Kill switch triggered',
        status: 'Success',
        route: 'Risk',
        stream: 'Controls',
        related: this.buildRelated(state),
        referenceId: state.id,
        correlationId: state.id,
        description: state.reason,
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Risk',
        source: `kill-switch.${state.scope}`,
        message: `Kill switch active: ${state.reason}`,
        route: 'Risk review',
        severity: 'Critical',
        urgency: 'Live order placement is blocked until the kill switch is cleared.',
      });

      const mapped = this.mapState(state);
      return {
        message: 'Kill switch triggered',
        active: true,
        triggeredAt: mapped.triggeredAt,
        triggeredAtIso: mapped.triggeredAtIso,
        scope: mapped.scope,
        brokerKey: mapped.brokerKey,
        accountId: mapped.accountId,
        reason: mapped.reason,
        state: mapped,
        time: buildApiTimeContract(timeZone),
      };
    } catch (error) {
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Risk',
        source: 'kill-switch.trigger-failed',
        message: `Kill switch trigger failed: ${this.readErrorMessage(error)}`,
        route: 'Risk review',
        severity: 'Critical',
      });
      throw error;
    }
  }

  async clear(userId: string, body: RiskKillSwitchBody = {}): Promise<RiskKillSwitchResult> {
    const validated = validateRiskKillSwitchClearBody(body);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);

    try {
      const clearedCount = await this.riskKillSwitchRepository.clearActive(userId, {
        scope: validated.scope,
        brokerKey: validated.brokerKey,
        accountId: validated.accountId,
        clearedBy: userId,
      });

      await this.operationalEventService.logActivity(userId, {
        type: 'Risk control',
        title: 'Kill switch cleared',
        status: 'Success',
        route: 'Risk',
        stream: 'Controls',
        related: this.buildTargetRelated(validated),
        description: validated.reason,
      });

      const clearedAtIso = new Date().toISOString();
      return {
        message:
          clearedCount > 0
            ? 'Kill switch cleared'
            : 'No active kill switch matched the requested scope',
        active: false,
        triggeredAt: clearedAtIso,
        triggeredAtIso: clearedAtIso,
        scope: validated.scope,
        brokerKey: validated.brokerKey,
        accountId: validated.accountId,
        reason: validated.reason,
        clearedCount,
        time: buildApiTimeContract(timeZone),
      };
    } catch (error) {
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Risk',
        source: 'kill-switch.clear-failed',
        message: `Kill switch clear failed: ${this.readErrorMessage(error)}`,
        route: 'Risk review',
        severity: 'Critical',
      });
      throw error;
    }
  }

  async findActiveLiveTradingBlock(
    userId: string,
    context: { brokerKey?: string | null; accountId?: string | null } = {}
  ): Promise<RiskKillSwitchStateItem | null> {
    const block = await this.riskKillSwitchRepository.findActiveBlock(userId, context);
    return block ? this.mapState(block) : null;
  }

  async assertLiveTradingAllowed(
    userId: string,
    context: { brokerKey?: string | null; accountId?: string | null } = {}
  ): Promise<void> {
    const block = await this.findActiveLiveTradingBlock(userId, context);
    if (!block) {
      return;
    }
    throw new BadRequestAppError(
      `Risk kill switch is active for ${this.describeBlock(block)}. Live order placement is blocked until it is cleared.`
    );
  }

  private mapState(state: RiskKillSwitchState): RiskKillSwitchStateItem {
    const triggeredAtIso = state.triggeredAt.toISOString();
    return {
      id: state.id,
      active: state.active,
      scope: state.scope,
      brokerKey: state.brokerKey,
      accountId: state.accountId,
      reason: state.reason,
      triggeredBy: state.triggeredBy,
      triggeredAt: triggeredAtIso,
      triggeredAtIso,
      clearedBy: state.clearedBy,
      clearedAt: state.clearedAt ? state.clearedAt.toISOString() : null,
      clearedAtIso: state.clearedAt ? state.clearedAt.toISOString() : null,
    };
  }

  private describeBlock(state: RiskKillSwitchStateItem): string {
    if (state.scope === 'broker' && state.brokerKey) {
      return state.accountId
        ? `${state.brokerKey} account ${state.accountId}`
        : `broker ${state.brokerKey}`;
    }
    return state.scope;
  }

  private buildRelated(state: RiskKillSwitchState): string {
    return this.buildTargetRelated({
      scope: state.scope,
      brokerKey: state.brokerKey,
      accountId: state.accountId,
    });
  }

  private buildTargetRelated(target: {
    scope: string;
    brokerKey?: string | null;
    accountId?: string | null;
  }): string {
    return [target.scope, target.brokerKey, target.accountId].filter(Boolean).join(' · ');
  }

  private readErrorMessage(error: unknown): string {
    return error instanceof Error && error.message ? error.message : 'Unknown error';
  }
}
