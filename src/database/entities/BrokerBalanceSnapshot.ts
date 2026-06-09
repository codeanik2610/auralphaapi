import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'broker_balance_snapshots' })
@Unique('uq_broker_balance_snapshots_user_broker_account_external', [
  'userId',
  'brokerKey',
  'accountId',
  'externalId',
])
@Index('idx_broker_balance_snapshots_user_broker_account_observed_at', [
  'userId',
  'brokerKey',
  'accountId',
  'observedAt',
])
export class BrokerBalanceSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId!: string;

  @Column({ name: 'broker_key', type: 'varchar', length: 100 })
  brokerKey!: string;

  @Column({ name: 'account_id', type: 'char', length: 36 })
  accountId!: string;

  @Column({ name: 'external_id', type: 'varchar', length: 191 })
  externalId!: string;

  @Column({ name: 'wallet_balance', type: 'decimal', precision: 30, scale: 12, nullable: true })
  walletBalance!: string | null;

  @Column({ name: 'futures_balance', type: 'decimal', precision: 30, scale: 12, nullable: true })
  futuresBalance!: string | null;

  @Column({ name: 'total_balance', type: 'decimal', precision: 30, scale: 12, nullable: true })
  totalBalance!: string | null;

  @Column({ name: 'available_balance', type: 'decimal', precision: 30, scale: 12, nullable: true })
  availableBalance!: string | null;

  @Column({ name: 'locked_amount', type: 'decimal', precision: 30, scale: 12, nullable: true })
  lockedAmount!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  currency!: string | null;

  @Column({ name: 'source_snapshot_id', type: 'char', length: 36, nullable: true })
  sourceSnapshotId!: string | null;

  @Column({ name: 'observed_at', type: 'timestamp', nullable: true })
  observedAt!: Date | null;

  @Column({ name: 'raw_payload_json', type: 'json', nullable: true })
  rawPayload!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, default: 'broker_reconciliation' })
  source!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
