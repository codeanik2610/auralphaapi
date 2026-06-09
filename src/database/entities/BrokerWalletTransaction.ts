import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'broker_wallet_transactions' })
@Unique('uq_broker_wallet_transactions_user_broker_account_external', [
  'userId',
  'brokerKey',
  'accountId',
  'externalId',
])
@Index('idx_broker_wallet_transactions_user_broker_account_occurred_at', [
  'userId',
  'brokerKey',
  'accountId',
  'occurredAt',
])
@Index('idx_broker_wallet_transactions_reference', [
  'userId',
  'brokerKey',
  'accountId',
  'referenceId',
])
export class BrokerWalletTransaction {
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

  @Column({ name: 'transaction_type', type: 'varchar', length: 64 })
  transactionType!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  symbol!: string | null;

  @Column({ name: 'reference_id', type: 'varchar', length: 191, nullable: true })
  referenceId!: string | null;

  @Column({ name: 'order_id', type: 'varchar', length: 191, nullable: true })
  orderId!: string | null;

  @Column({ name: 'position_id', type: 'varchar', length: 191, nullable: true })
  positionId!: string | null;

  @Column({ type: 'decimal', precision: 30, scale: 12 })
  amount!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  currency!: string | null;

  @Column({ name: 'balance_before', type: 'decimal', precision: 30, scale: 12, nullable: true })
  balanceBefore!: string | null;

  @Column({ name: 'balance_after', type: 'decimal', precision: 30, scale: 12, nullable: true })
  balanceAfter!: string | null;

  @Column({ name: 'occurred_at', type: 'timestamp', nullable: true })
  occurredAt!: Date | null;

  @Column({ name: 'raw_payload_json', type: 'json', nullable: true })
  rawPayload!: Record<string, unknown> | null;

  @Column({ name: 'match_state', type: 'varchar', length: 32, default: 'unmatched' })
  matchState!: string;

  @Column({ name: 'match_confidence', type: 'varchar', length: 32, default: 'unknown' })
  matchConfidence!: string;

  @Column({ type: 'varchar', length: 64, default: 'broker_reconciliation' })
  source!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
