import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { SettingsAuditLog } from '../entities/SettingsAuditLog';

export interface SettingsAuditListQuery {
  limit: number;
  offset: number;
}

export interface CreateSettingsAuditPayload {
  userId: string;
  fieldName: string;
  oldValue: string | null;
  oldValueType?: string | null;
  oldValueJson?: string | boolean | number | null;
  newValue: string | null;
  newValueType?: string | null;
  newValueJson?: string | boolean | number | null;
  changeType?: string | null;
  actor?: string | null;
}

@Service()
export class SettingsAuditRepository {
  private get settingsAuditRepository(): Repository<SettingsAuditLog> {
    return coreDataSource.getRepository(SettingsAuditLog);
  }

  async listAuditLogs(userId: string, query: SettingsAuditListQuery) {
    const [items, total] = await this.settingsAuditRepository.findAndCount({ where: { userId }, order: { createdAt: 'DESC' }, skip: query.offset, take: query.limit });
    return { items, total };
  }

  async createAuditLog(payload: CreateSettingsAuditPayload): Promise<SettingsAuditLog> {
    const created = this.settingsAuditRepository.create({
      userId: payload.userId,
      fieldName: payload.fieldName,
      oldValue: payload.oldValue,
      oldValueType: payload.oldValueType ?? null,
      oldValueJson: payload.oldValueJson ?? null,
      newValue: payload.newValue,
      newValueType: payload.newValueType ?? null,
      newValueJson: payload.newValueJson ?? null,
      changeType: payload.changeType ?? null,
      actor: payload.actor ?? 'operator'
    });
    return this.settingsAuditRepository.save(created);
  }
}
