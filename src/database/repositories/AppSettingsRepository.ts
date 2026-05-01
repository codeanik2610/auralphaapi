import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { AppSetting } from '../entities/AppSetting';
import type { BacktestPromotionRules } from '../../api/contracts/Settings';

export interface AppSettingsPayload {
  timezone: string;
  notifyEmail: boolean;
  notifyInApp: boolean;
  notifyWhatsapp: boolean;
  whatsappLiveTradeSuggestions: boolean;
  whatsappNumber: string | null;
  confirmDestructive: boolean;
  notificationChannel: 'both' | 'in-app' | 'email' | 'disabled';
  notificationSeverity: 'all' | 'medium' | 'high' | 'critical';
  escalationRoute: 'risk-review' | 'on-call' | 'manual';
  escalationSlaMinutes: number;
  backtestPromotionRules: BacktestPromotionRules;
}

@Service()
export class AppSettingsRepository {
  private get appSettingsRepository(): Repository<AppSetting> {
    return coreDataSource.getRepository(AppSetting);
  }

  async getSettings(userId: string): Promise<AppSetting | null> {
    return this.appSettingsRepository.findOne({ where: { userId } });
  }

  async upsertSettings(userId: string, payload: AppSettingsPayload): Promise<AppSetting> {
    const existing = await this.getSettings(userId);
    if (existing) {
      await this.appSettingsRepository.update({ id: existing.id, userId }, payload);
      return (await this.getSettings(userId)) as AppSetting;
    }

    const created = this.appSettingsRepository.create({ userId, ...payload });
    return this.appSettingsRepository.save(created);
  }
}
