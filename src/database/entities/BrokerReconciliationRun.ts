import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'broker_reconciliation_runs' })
@Index('idx_broker_reconciliation_runs_user_broker_started_at', [
  'userId',
  'brokerKey',
  'startedAt',
])
@Index('idx_broker_reconciliation_runs_status', ['status', 'startedAt'])
export class BrokerReconciliationRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId!: string;

  @Column({ name: 'broker_key', type: 'varchar', length: 100 })
  brokerKey!: string;

  @Column({ name: 'account_id', type: 'char', length: 36, nullable: true })
  accountId!: string | null;

  @Column({ name: 'run_type', type: 'varchar', length: 64 })
  runType!: string;

  @Column({ type: 'varchar', length: 32, default: 'running' })
  status!: string;

  @Column({ name: 'window_start_at', type: 'timestamp', nullable: true })
  windowStartAt!: Date | null;

  @Column({ name: 'window_end_at', type: 'timestamp', nullable: true })
  windowEndAt!: Date | null;

  @Column({ name: 'started_at', type: 'timestamp' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamp', nullable: true })
  finishedAt!: Date | null;

  @Column({ name: 'fills_count', type: 'int', default: 0 })
  fillsCount!: number;

  @Column({ name: 'fee_entries_count', type: 'int', default: 0 })
  feeEntriesCount!: number;

  @Column({ name: 'funding_entries_count', type: 'int', default: 0 })
  fundingEntriesCount!: number;

  @Column({ name: 'wallet_transactions_count', type: 'int', default: 0 })
  walletTransactionsCount!: number;

  @Column({ name: 'balance_snapshots_count', type: 'int', default: 0 })
  balanceSnapshotsCount!: number;

  @Column({ name: 'gross_pnl', type: 'decimal', precision: 30, scale: 12, nullable: true })
  grossPnl!: string | null;

  @Column({ name: 'fees_total', type: 'decimal', precision: 30, scale: 12, nullable: true })
  feesTotal!: string | null;

  @Column({ name: 'funding_total', type: 'decimal', precision: 30, scale: 12, nullable: true })
  fundingTotal!: string | null;

  @Column({ name: 'net_pnl', type: 'decimal', precision: 30, scale: 12, nullable: true })
  netPnl!: string | null;

  @Column({ name: 'balance_delta', type: 'decimal', precision: 30, scale: 12, nullable: true })
  balanceDelta!: string | null;

  @Column({ name: 'unmatched_delta', type: 'decimal', precision: 30, scale: 12, nullable: true })
  unmatchedDelta!: string | null;

  @Column({ name: 'summary_json', type: 'json', nullable: true })
  summaryPayload!: Record<string, unknown> | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
