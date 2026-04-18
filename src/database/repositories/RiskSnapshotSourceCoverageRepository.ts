import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { RiskSnapshotSourceCoverage } from '../entities/RiskSnapshotSourceCoverage';

export interface ComputedRiskSnapshotSourceCoveragePayload {
  brokerKey: string;
  accountId: string;
  accountName: string;
  latestFundsSnapshotId: string | null;
  latestFundsSnapshotDate: string | null;
  latestFundsObservedAt: Date | null;
  latestFundsComputedAt: Date | null;
  latestFundsLastAttemptAt: Date | null;
  latestFundsFetchStatus: string | null;
  latestFundsErrorMessage: string | null;
  latestFundsSource: string | null;
  latestWalletAvailable: boolean;
  latestFuturesAvailable: boolean;
  latestSuccessFundsSnapshotId: string | null;
  latestSuccessFundsSnapshotDate: string | null;
  latestSuccessFundsObservedAt: Date | null;
  latestSuccessFundsComputedAt: Date | null;
  latestSuccessFundsSource: string | null;
  latestSuccessWalletAvailable: boolean;
  latestSuccessFuturesAvailable: boolean;
  positionsObservedAt: Date | null;
  positionsCheckpointAt: Date | null;
  openPositions: number;
  positionTotalRows: number;
  positionSnapshotRows: number;
  positionReadModelRows: number;
  rowsMissingFromReadModel: number;
  rowsBehindSnapshot: number;
  orphanReadModelRows: number;
  latestPositionSnapshotSeenAt: Date | null;
  latestPositionReadModelSeenAt: Date | null;
  openOrderRows: number;
  latestOrderSeenAt: Date | null;
}

@Service()
export class RiskSnapshotSourceCoverageRepository {
  private get sourceCoverageRepository(): Repository<RiskSnapshotSourceCoverage> {
    return coreDataSource.getRepository(RiskSnapshotSourceCoverage);
  }

  async createComputedSourceCoverage(
    userId: string,
    snapshotId: string,
    payloads: ComputedRiskSnapshotSourceCoveragePayload[]
  ): Promise<number> {
    if (!payloads.length) {
      return 0;
    }

    const created = this.sourceCoverageRepository.create(
      payloads.map((payload) => ({
        snapshotId,
        userId,
        brokerKey: payload.brokerKey,
        accountId: payload.accountId,
        accountName: payload.accountName,
        latestFundsSnapshotId: payload.latestFundsSnapshotId,
        latestFundsSnapshotDate: payload.latestFundsSnapshotDate,
        latestFundsObservedAt: payload.latestFundsObservedAt,
        latestFundsComputedAt: payload.latestFundsComputedAt,
        latestFundsLastAttemptAt: payload.latestFundsLastAttemptAt,
        latestFundsFetchStatus: payload.latestFundsFetchStatus,
        latestFundsErrorMessage: payload.latestFundsErrorMessage,
        latestFundsSource: payload.latestFundsSource,
        latestWalletAvailable: payload.latestWalletAvailable,
        latestFuturesAvailable: payload.latestFuturesAvailable,
        latestSuccessFundsSnapshotId: payload.latestSuccessFundsSnapshotId,
        latestSuccessFundsSnapshotDate: payload.latestSuccessFundsSnapshotDate,
        latestSuccessFundsObservedAt: payload.latestSuccessFundsObservedAt,
        latestSuccessFundsComputedAt: payload.latestSuccessFundsComputedAt,
        latestSuccessFundsSource: payload.latestSuccessFundsSource,
        latestSuccessWalletAvailable: payload.latestSuccessWalletAvailable,
        latestSuccessFuturesAvailable: payload.latestSuccessFuturesAvailable,
        positionsObservedAt: payload.positionsObservedAt,
        positionsCheckpointAt: payload.positionsCheckpointAt,
        openPositions: payload.openPositions,
        positionTotalRows: payload.positionTotalRows,
        positionSnapshotRows: payload.positionSnapshotRows,
        positionReadModelRows: payload.positionReadModelRows,
        rowsMissingFromReadModel: payload.rowsMissingFromReadModel,
        rowsBehindSnapshot: payload.rowsBehindSnapshot,
        orphanReadModelRows: payload.orphanReadModelRows,
        latestPositionSnapshotSeenAt: payload.latestPositionSnapshotSeenAt,
        latestPositionReadModelSeenAt: payload.latestPositionReadModelSeenAt,
        openOrderRows: payload.openOrderRows,
        latestOrderSeenAt: payload.latestOrderSeenAt,
      }))
    );

    await this.sourceCoverageRepository.save(created);
    return created.length;
  }

  async listBySnapshotId(snapshotId: string): Promise<RiskSnapshotSourceCoverage[]> {
    const normalizedSnapshotId = String(snapshotId || '').trim();
    if (!normalizedSnapshotId) {
      return [];
    }

    return this.sourceCoverageRepository.find({
      where: {
        snapshotId: normalizedSnapshotId,
      },
      order: {
        brokerKey: 'ASC',
        accountName: 'ASC',
        accountId: 'ASC',
      },
    });
  }
}
