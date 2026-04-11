import { Inject, Service } from 'typedi';
import { PositionReadModelRepository } from './PositionReadModelRepository';

export interface PositionSnapshotAccountSummary {
  accountId: string;
  openPositions: number;
  observedAt: Date | null;
  hasSnapshotHistory: boolean;
}

@Service()
export class PositionSnapshotRepository {
  @Inject(() => PositionReadModelRepository)
  private positionReadModelRepository!: PositionReadModelRepository;

  async getAccountOpenPositionSummary(
    userId: string,
    accountIds: string[]
  ): Promise<Map<string, PositionSnapshotAccountSummary>> {
    const normalizedAccountIds = Array.from(
      new Set(accountIds.map((item) => String(item || '').trim()).filter(Boolean))
    );

    if (!normalizedAccountIds.length) {
      return new Map();
    }

    try {
      await this.positionReadModelRepository.ensureHydratedFromSnapshots(
        userId,
        normalizedAccountIds
      );
      const byAccountId = await this.positionReadModelRepository.getAccountOpenPositionSummary(
        userId,
        normalizedAccountIds
      );
      return new Map(
        Array.from(byAccountId.entries()).map(([accountId, row]) => [
          accountId,
          {
            accountId,
            openPositions: row.openPositions,
            observedAt: this.toDate(row.observedAt),
            hasSnapshotHistory: row.hasSnapshotHistory,
          },
        ])
      );
    } catch (error) {
      if (this.isMissingTableError(error)) {
        return new Map();
      }
      throw error;
    }
  }

  private toDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private isMissingTableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const code = String((error as { code?: string }).code || '').trim();
    const message = String((error as { message?: string }).message || '').toLowerCase();

    return (
      code === 'ER_NO_SUCH_TABLE' ||
      code === '42P01' ||
      ((message.includes('scheduler_positions_snapshots') ||
        message.includes('position_read_models')) &&
        message.includes('doesn\'t exist'))
    );
  }
}
