import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'risk_snapshot_source_coverage' })
@Index('idx_risk_snapshot_source_coverage_snapshot_id', ['snapshotId'])
@Index('uidx_risk_snapshot_source_coverage_snapshot_account', ['snapshotId', 'accountId'], {
  unique: true,
})
@Index('idx_risk_snapshot_source_coverage_user_account_created_at', ['userId', 'accountId', 'createdAt'])
export class RiskSnapshotSourceCoverage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'snapshot_id', type: 'char', length: 36 })
  snapshotId!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ name: 'broker_key', type: 'varchar', length: 100 })
  brokerKey!: string;

  @Column({ name: 'account_id', type: 'varchar', length: 191 })
  accountId!: string;

  @Column({ name: 'account_name', type: 'varchar', length: 255 })
  accountName!: string;

  @Column({ name: 'latest_funds_snapshot_id', type: 'char', length: 36, nullable: true })
  latestFundsSnapshotId!: string | null;

  @Column({ name: 'latest_funds_snapshot_date', type: 'varchar', length: 64, nullable: true })
  latestFundsSnapshotDate!: string | null;

  @Column({ name: 'latest_funds_observed_at', type: 'timestamp', nullable: true })
  latestFundsObservedAt!: Date | null;

  @Column({ name: 'latest_funds_computed_at', type: 'timestamp', nullable: true })
  latestFundsComputedAt!: Date | null;

  @Column({ name: 'latest_funds_last_attempt_at', type: 'timestamp', nullable: true })
  latestFundsLastAttemptAt!: Date | null;

  @Column({ name: 'latest_funds_fetch_status', type: 'varchar', length: 20, nullable: true })
  latestFundsFetchStatus!: string | null;

  @Column({ name: 'latest_funds_error_message', type: 'text', nullable: true })
  latestFundsErrorMessage!: string | null;

  @Column({ name: 'latest_funds_source', type: 'varchar', length: 50, nullable: true })
  latestFundsSource!: string | null;

  @Column({ name: 'latest_wallet_available', type: 'boolean', default: false })
  latestWalletAvailable!: boolean;

  @Column({ name: 'latest_futures_available', type: 'boolean', default: false })
  latestFuturesAvailable!: boolean;

  @Column({ name: 'latest_success_funds_snapshot_id', type: 'char', length: 36, nullable: true })
  latestSuccessFundsSnapshotId!: string | null;

  @Column({ name: 'latest_success_funds_snapshot_date', type: 'varchar', length: 64, nullable: true })
  latestSuccessFundsSnapshotDate!: string | null;

  @Column({ name: 'latest_success_funds_observed_at', type: 'timestamp', nullable: true })
  latestSuccessFundsObservedAt!: Date | null;

  @Column({ name: 'latest_success_funds_computed_at', type: 'timestamp', nullable: true })
  latestSuccessFundsComputedAt!: Date | null;

  @Column({ name: 'latest_success_funds_source', type: 'varchar', length: 50, nullable: true })
  latestSuccessFundsSource!: string | null;

  @Column({ name: 'latest_success_wallet_available', type: 'boolean', default: false })
  latestSuccessWalletAvailable!: boolean;

  @Column({ name: 'latest_success_futures_available', type: 'boolean', default: false })
  latestSuccessFuturesAvailable!: boolean;

  @Column({ name: 'positions_observed_at', type: 'timestamp', nullable: true })
  positionsObservedAt!: Date | null;

  @Column({ name: 'positions_checkpoint_at', type: 'timestamp', nullable: true })
  positionsCheckpointAt!: Date | null;

  @Column({ name: 'open_positions', type: 'int', unsigned: true, default: 0 })
  openPositions!: number;

  @Column({ name: 'position_total_rows', type: 'int', unsigned: true, default: 0 })
  positionTotalRows!: number;

  @Column({ name: 'position_snapshot_rows', type: 'int', unsigned: true, default: 0 })
  positionSnapshotRows!: number;

  @Column({ name: 'position_read_model_rows', type: 'int', unsigned: true, default: 0 })
  positionReadModelRows!: number;

  @Column({ name: 'rows_missing_from_read_model', type: 'int', unsigned: true, default: 0 })
  rowsMissingFromReadModel!: number;

  @Column({ name: 'rows_behind_snapshot', type: 'int', unsigned: true, default: 0 })
  rowsBehindSnapshot!: number;

  @Column({ name: 'orphan_read_model_rows', type: 'int', unsigned: true, default: 0 })
  orphanReadModelRows!: number;

  @Column({ name: 'latest_position_snapshot_seen_at', type: 'timestamp', nullable: true })
  latestPositionSnapshotSeenAt!: Date | null;

  @Column({ name: 'latest_position_read_model_seen_at', type: 'timestamp', nullable: true })
  latestPositionReadModelSeenAt!: Date | null;

  @Column({ name: 'open_order_rows', type: 'int', unsigned: true, default: 0 })
  openOrderRows!: number;

  @Column({ name: 'latest_order_seen_at', type: 'timestamp', nullable: true })
  latestOrderSeenAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
