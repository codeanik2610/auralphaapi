import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { ActivitySavedView } from '../entities/ActivitySavedView';

export interface CreateActivitySavedViewPayload {
  userId: string;
  name: string;
  description?: string | null;
  isDefault?: boolean;
  view: string;
  groupBy?: string | null;
  sortBy: string;
  sortOrder: string;
  readState: string;
  filters?: Record<string, string> | null;
}

@Service()
export class ActivitySavedViewRepository {
  private get repository(): Repository<ActivitySavedView> {
    return coreDataSource.getRepository(ActivitySavedView);
  }

  async listViews(userId: string): Promise<ActivitySavedView[]> {
    return this.repository.find({
      where: { userId },
      order: {
        isDefault: 'DESC',
        updatedAt: 'DESC',
      },
    });
  }

  async getViewById(userId: string, viewId: string): Promise<ActivitySavedView | null> {
    return this.repository.findOne({
      where: {
        id: viewId,
        userId,
      },
    });
  }

  async clearDefaultViews(userId: string): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(ActivitySavedView)
      .set({ isDefault: false })
      .where('user_id = :userId', { userId })
      .execute();
  }

  async createView(payload: CreateActivitySavedViewPayload): Promise<ActivitySavedView> {
    if (payload.isDefault) {
      await this.clearDefaultViews(payload.userId);
    }

    const created = this.repository.create({
      userId: payload.userId,
      name: payload.name,
      description: payload.description ?? null,
      isDefault: payload.isDefault === true,
      view: payload.view,
      groupBy: payload.groupBy ?? null,
      sortBy: payload.sortBy,
      sortOrder: payload.sortOrder,
      readState: payload.readState,
      filters: payload.filters ?? null,
    });

    return this.repository.save(created);
  }

  async updateView(
    userId: string,
    viewId: string,
    payload: Partial<CreateActivitySavedViewPayload>
  ): Promise<ActivitySavedView | null> {
    const existing = await this.getViewById(userId, viewId);
    if (!existing) {
      return null;
    }

    if (payload.isDefault) {
      await this.clearDefaultViews(userId);
    }

    await this.repository.update(
      { id: viewId, userId },
      {
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.description !== undefined ? { description: payload.description ?? null } : {}),
        ...(payload.isDefault !== undefined ? { isDefault: payload.isDefault } : {}),
        ...(payload.view !== undefined ? { view: payload.view } : {}),
        ...(payload.groupBy !== undefined ? { groupBy: payload.groupBy ?? null } : {}),
        ...(payload.sortBy !== undefined ? { sortBy: payload.sortBy } : {}),
        ...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
        ...(payload.readState !== undefined ? { readState: payload.readState } : {}),
        ...(payload.filters !== undefined ? { filters: payload.filters ?? null } : {}),
      }
    );

    return this.getViewById(userId, viewId);
  }

  async deleteView(userId: string, viewId: string): Promise<boolean> {
    const result = await this.repository.delete({ id: viewId, userId });
    return Number(result.affected || 0) > 0;
  }
}
