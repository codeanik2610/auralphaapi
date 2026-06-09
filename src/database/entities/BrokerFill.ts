import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'broker_fills' })
@Unique('uq_broker_fills_user_broker_account_external', [
  'userId',
  'brokerKey',
  'accountId',
  'externalId',
])
@Index('idx_broker_fills_user_broker_account_filled_at', [
  'userId',
  'brokerKey',
  'accountId',
  'filledAt',
])
@Index('idx_broker_fills_order_id', ['userId', 'brokerKey', 'accountId', 'orderId'])
@Index('idx_broker_fills_suggested_trade', ['userId', 'suggestedTradeId'])
export class BrokerFill {
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

  @Column({ name: 'order_id', type: 'varchar', length: 191, nullable: true })
  orderId!: string | null;

  @Column({ name: 'position_id', type: 'varchar', length: 191, nullable: true })
  positionId!: string | null;

  @Column({ name: 'suggested_trade_id', type: 'char', length: 36, nullable: true })
  suggestedTradeId!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  symbol!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  side!: string | null;

  @Column({ name: 'liquidity_role', type: 'varchar', length: 32, nullable: true })
  liquidityRole!: string | null;

  @Column({ name: 'order_type', type: 'varchar', length: 64, nullable: true })
  orderType!: string | null;

  @Column({ name: 'trade_currency', type: 'varchar', length: 32, nullable: true })
  tradeCurrency!: string | null;

  @Column({ type: 'decimal', precision: 30, scale: 12, nullable: true })
  quantity!: string | null;

  @Column({ type: 'decimal', precision: 30, scale: 12, nullable: true })
  price!: string | null;

  @Column({ type: 'decimal', precision: 30, scale: 12, nullable: true })
  notional!: string | null;

  @Column({ name: 'commission_amount', type: 'decimal', precision: 30, scale: 12, nullable: true })
  commissionAmount!: string | null;

  @Column({ name: 'commission_currency', type: 'varchar', length: 32, nullable: true })
  commissionCurrency!: string | null;

  @Column({ name: 'fee_source', type: 'varchar', length: 64, nullable: true })
  feeSource!: string | null;

  @Column({ name: 'filled_at', type: 'timestamp', nullable: true })
  filledAt!: Date | null;

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
