import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'risk_order_snapshots' })
@Index('idx_risk_order_snapshots_snapshot_id', ['snapshotId'])
@Index('idx_risk_order_snapshots_user_created_at', ['userId', 'createdAt'])
@Index('idx_risk_order_snapshots_user_account_created_at', ['userId', 'accountId', 'createdAt'])
export class RiskOrderSnapshot {
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

  @Column({ name: 'external_id', type: 'varchar', length: 191 })
  externalId!: string;

  @Column({ name: 'order_id', type: 'varchar', length: 191, nullable: true })
  orderId!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  symbol!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  side!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  status!: string | null;

  @Column({ name: 'order_type', type: 'varchar', length: 50, nullable: true })
  orderType!: string | null;

  @Column({ name: 'trigger_type', type: 'varchar', length: 50, nullable: true })
  triggerType!: string | null;

  @Column({ type: 'double', nullable: true })
  quantity!: number | null;

  @Column({ name: 'filled_quantity', type: 'double', nullable: true })
  filledQuantity!: number | null;

  @Column({ name: 'remaining_quantity', type: 'double', nullable: true })
  remainingQuantity!: number | null;

  @Column({ type: 'double', nullable: true })
  price!: number | null;

  @Column({ name: 'order_price', type: 'double', nullable: true })
  orderPrice!: number | null;

  @Column({ name: 'trigger_price', type: 'double', nullable: true })
  triggerPrice!: number | null;

  @Column({ name: 'filled_price', type: 'double', nullable: true })
  filledPrice!: number | null;

  @Column({ name: 'last_price', type: 'double', nullable: true })
  lastPrice!: number | null;

  @Column({ name: 'stoploss_price', type: 'double', nullable: true })
  stoplossPrice!: number | null;

  @Column({ name: 'takeprofit_price', type: 'double', nullable: true })
  takeprofitPrice!: number | null;

  @Column({ type: 'double', nullable: true })
  leverage!: number | null;

  @Column({ name: 'reduce_only', type: 'boolean', nullable: true })
  reduceOnly!: boolean | null;

  @Column({ name: 'snapshot_status_rank', type: 'int', default: 0 })
  snapshotStatusRank!: number;

  @Column({ type: 'double', nullable: true })
  notional!: number | null;

  @Column({ name: 'reserved_margin', type: 'double', nullable: true })
  reservedMargin!: number | null;

  @Column({ name: 'order_created_at', type: 'timestamp', nullable: true })
  orderCreatedAt!: Date | null;

  @Column({ name: 'order_updated_at', type: 'timestamp', nullable: true })
  orderUpdatedAt!: Date | null;

  @Column({ name: 'order_canceled_at', type: 'timestamp', nullable: true })
  orderCanceledAt!: Date | null;

  @Column({ name: 'first_seen_at', type: 'timestamp', nullable: true })
  firstSeenAt!: Date | null;

  @Column({ name: 'last_seen_at', type: 'timestamp', nullable: true })
  lastSeenAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
