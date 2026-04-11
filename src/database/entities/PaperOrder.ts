import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'paper_orders' })
@Index('idx_paper_orders_user_status_created_at', ['userId', 'status', 'createdAt'])
@Index('idx_paper_orders_account_created_at', ['accountId', 'createdAt'])
@Index('idx_paper_orders_suggested_trade_id', ['suggestedTradeId'])
export class PaperOrder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId!: string;

  @Column({ name: 'suggested_trade_id', type: 'char', length: 36, nullable: true })
  suggestedTradeId!: string | null;

  @Column({ name: 'asset_id', type: 'varchar', length: 191 })
  assetId!: string;

  @Column({ name: 'broker_key', type: 'varchar', length: 100 })
  brokerKey!: string;

  @Column({ name: 'account_id', type: 'char', length: 36 })
  accountId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  symbol!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  side!: string | null;

  @Column({ name: 'order_type', type: 'varchar', length: 64, nullable: true })
  orderType!: string | null;

  @Column({ name: 'trigger_type', type: 'varchar', length: 64, nullable: true })
  triggerType!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'OPEN' })
  status!: string;

  @Column({ type: 'double', nullable: true })
  leverage!: number | null;

  @Column({ type: 'decimal', precision: 30, scale: 12, nullable: true })
  quantity!: string | null;

  @Column({ name: 'order_price', type: 'decimal', precision: 30, scale: 12, nullable: true })
  orderPrice!: string | null;

  @Column({
    name: 'stoploss_price',
    type: 'decimal',
    precision: 30,
    scale: 12,
    nullable: true,
  })
  stoplossPrice!: string | null;

  @Column({
    name: 'takeprofit_price',
    type: 'decimal',
    precision: 30,
    scale: 12,
    nullable: true,
  })
  takeprofitPrice!: string | null;

  @Column({ name: 'reduce_only', type: 'boolean', default: false })
  reduceOnly!: boolean;

  @Column({ name: 'payload_json', type: 'json', nullable: true })
  payload!: Record<string, unknown> | null;

  @Column({ name: 'canceled_at', type: 'timestamp', nullable: true })
  canceledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
