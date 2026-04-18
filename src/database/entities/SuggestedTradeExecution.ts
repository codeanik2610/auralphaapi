import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SuggestedTrade } from './SuggestedTrade';

@Entity({ name: 'suggested_trade_executions' })
@Index('idx_suggested_trade_executions_user_order_lookup', [
  'userId',
  'brokerKey',
  'accountId',
  'orderId',
])
@Index('idx_suggested_trade_executions_user_paper_order_lookup', ['userId', 'paperOrderId'])
@Index('idx_suggested_trade_executions_user_position_lookup', [
  'userId',
  'brokerKey',
  'accountId',
  'positionId',
])
@Index('idx_suggested_trade_executions_user_state_seen_at', [
  'userId',
  'brokerKey',
  'accountId',
  'executionState',
  'lastSeenAt',
])
export class SuggestedTradeExecution {
  @PrimaryColumn({ name: 'suggested_trade_id', type: 'char', length: 36 })
  suggestedTradeId!: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId!: string;

  @Column({ name: 'execution_mode', type: 'varchar', length: 16, nullable: true })
  executionMode!: string | null;

  @Column({ name: 'pre_trade_check_id', type: 'char', length: 36, nullable: true })
  preTradeCheckId!: string | null;

  @Column({ name: 'pre_trade_state', type: 'varchar', length: 20, nullable: true })
  preTradeState!: string | null;

  @Column({ name: 'pre_trade_checked_at', type: 'timestamp', nullable: true })
  preTradeCheckedAt!: Date | null;

  @Column({ name: 'pre_trade_blocked_reason', type: 'text', nullable: true })
  preTradeBlockedReason!: string | null;

  @Column({ name: 'accepted_by', type: 'varchar', length: 16, nullable: true })
  acceptedBy!: string | null;

  @Column({ name: 'accepted_at', type: 'timestamp', nullable: true })
  acceptedAt!: Date | null;

  @Column({ name: 'order_id', type: 'varchar', length: 191, nullable: true })
  orderId!: string | null;

  @Column({ name: 'paper_order_id', type: 'char', length: 36, nullable: true })
  paperOrderId!: string | null;

  @Column({ name: 'broker_key', type: 'varchar', length: 100, nullable: true })
  brokerKey!: string | null;

  @Column({ name: 'account_id', type: 'char', length: 36, nullable: true })
  accountId!: string | null;

  @Column({ name: 'order_status', type: 'varchar', length: 64, nullable: true })
  orderStatus!: string | null;

  @Column({ name: 'paper_order_status', type: 'varchar', length: 64, nullable: true })
  paperOrderStatus!: string | null;

  @Column({ name: 'execution_state', type: 'varchar', length: 32, nullable: true })
  executionState!: string | null;

  @Column({ name: 'order_type', type: 'varchar', length: 64, nullable: true })
  orderType!: string | null;

  @Column({ name: 'trigger_type', type: 'varchar', length: 64, nullable: true })
  triggerType!: string | null;

  @Column({ type: 'double', nullable: true })
  leverage!: number | null;

  @Column({ type: 'double', nullable: true })
  quantity!: number | null;

  @Column({ name: 'entry_price', type: 'decimal', precision: 30, scale: 12, nullable: true })
  entryPrice!: string | null;

  @Column({ name: 'stop_loss_price', type: 'decimal', precision: 30, scale: 12, nullable: true })
  stopLossPrice!: string | null;

  @Column({
    name: 'take_profit_price',
    type: 'decimal',
    precision: 30,
    scale: 12,
    nullable: true,
  })
  takeProfitPrice!: string | null;

  @Column({ name: 'submitted_at', type: 'timestamp', nullable: true })
  submittedAt!: Date | null;

  @Column({ name: 'linked_at', type: 'timestamp', nullable: true })
  linkedAt!: Date | null;

  @Column({ name: 'last_seen_at', type: 'timestamp', nullable: true })
  lastSeenAt!: Date | null;

  @Column({ name: 'filled_at', type: 'timestamp', nullable: true })
  filledAt!: Date | null;

  @Column({ name: 'canceled_at', type: 'timestamp', nullable: true })
  canceledAt!: Date | null;

  @Column({ name: 'filled_price', type: 'decimal', precision: 30, scale: 12, nullable: true })
  filledPrice!: string | null;

  @Column({ name: 'filled_quantity', type: 'double', nullable: true })
  filledQuantity!: number | null;

  @Column({ name: 'remaining_quantity', type: 'double', nullable: true })
  remainingQuantity!: number | null;

  @Column({ name: 'position_id', type: 'varchar', length: 191, nullable: true })
  positionId!: string | null;

  @Column({ name: 'position_status', type: 'varchar', length: 64, nullable: true })
  positionStatus!: string | null;

  @Column({ name: 'position_opened_at', type: 'timestamp', nullable: true })
  positionOpenedAt!: Date | null;

  @Column({ name: 'position_closed_at', type: 'timestamp', nullable: true })
  positionClosedAt!: Date | null;

  @Column({ name: 'exit_price', type: 'decimal', precision: 30, scale: 12, nullable: true })
  exitPrice!: string | null;

  @Column({ name: 'realized_pnl', type: 'decimal', precision: 30, scale: 12, nullable: true })
  realizedPnl!: string | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  outcome!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @OneToOne(() => SuggestedTrade, (suggestedTrade) => suggestedTrade.executionRecord, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'suggested_trade_id' })
  suggestedTrade!: SuggestedTrade;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
