import { Inject, Service } from 'typedi';
import { AppSettingsRepository } from '../../database';
import { DEFAULT_TIMEZONE, normalizeTimeZone } from '../utils/timezone';

@Service()
export class UserTimeZoneService {
  @Inject(() => AppSettingsRepository)
  private appSettingsRepository!: AppSettingsRepository;

  async resolveUserTimeZone(userId?: string | null): Promise<string> {
    if (!userId) {
      return DEFAULT_TIMEZONE;
    }
    const settings = await this.appSettingsRepository.getSettings(userId);
    return normalizeTimeZone(settings?.timezone, DEFAULT_TIMEZONE);
  }
}
