import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'risk_request_checks' })
@Index('idx_risk_request_checks_user_created_at', ['userId', 'createdAt'])
@Index('idx_risk_request_checks_user_snapshot_created_at', ['userId', 'snapshotId', 'createdAt'])
@Index('idx_risk_request_checks_user_suggested_trade_created_at', ['userId', 'suggestedTradeId', 'createdAt'])
export class RiskRequestCheck {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ name: 'snapshot_id', type: 'char', length: 36, nullable: true })
  snapshotId!: string | null;

  @Column({ name: 'suggested_trade_id', type: 'char', length: 36, nullable: true })
  suggestedTradeId!: string | null;

  @Column({ name: 'automation_id', type: 'char', length: 36, nullable: true })
  automationId!: string | null;

  @Column({ name: 'automation_run_id', type: 'char', length: 36, nullable: true })
  automationRunId!: string | null;

  @Column({ name: 'source_type', type: 'varchar', length: 40 })
  sourceType!: string;

  @Column({ name: 'execution_mode', type: 'varchar', length: 20 })
  executionMode!: string;

  @Column({ name: 'approval_mode', type: 'varchar', length: 20 })
  approvalMode!: string;

  @Column({ name: 'route_mode', type: 'varchar', length: 40 })
  routeMode!: string;

  @Column({ name: 'broker_key', type: 'varchar', length: 100, nullable: true })
  brokerKey!: string | null;

  @Column({ name: 'account_id', type: 'varchar', length: 191, nullable: true })
  accountId!: string | null;

  @Column({ type: 'varchar', length: 64 })
  symbol!: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  timeframe!: string | null;

  @Column({ type: 'varchar', length: 10 })
  side!: string;

  @Column({ name: 'order_type', type: 'varchar', length: 20 })
  orderType!: string;

  @Column({ name: 'time_in_force', type: 'varchar', length: 10, nullable: true })
  timeInForce!: string | null;

  @Column({ name: 'quantity_mode', type: 'varchar', length: 20 })
  quantityMode!: string;

  @Column({ type: 'double', nullable: true })
  quantity!: number | null;

  @Column({ type: 'double', nullable: true })
  notional!: number | null;

  @Column({ name: 'risk_percent', type: 'double', nullable: true })
  riskPercent!: number | null;

  @Column({ name: 'entry_price', type: 'double', nullable: true })
  entryPrice!: number | null;

  @Column({ name: 'stop_loss_price', type: 'double', nullable: true })
  stopLossPrice!: number | null;

  @Column({ name: 'take_profit_targets_json', type: 'json', nullable: true })
  takeProfitTargetsJson!: number[] | null;

  @Column({ type: 'double', nullable: true })
  leverage!: number | null;

  @Column({ name: 'reduce_only', type: 'boolean', default: false })
  reduceOnly!: boolean;

  @Column({ type: 'varchar', length: 20 })
  status!: string;

  @Column({ name: 'freshness_state', type: 'varchar', length: 20 })
  freshnessState!: string;

  @Column({ name: 'snapshot_lag_minutes', type: 'double', nullable: true })
  snapshotLagMinutes!: number | null;

  @Column({ name: 'checked_at', type: 'timestamp' })
  checkedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'boolean', default: false })
  allowed!: boolean;

  @Column({ type: 'boolean', default: false })
  blocked!: boolean;

  @Column({ name: 'approval_required', type: 'boolean', default: false })
  approvalRequired!: boolean;

  @Column({ name: 'blocking_rule_count', type: 'int', unsigned: true, default: 0 })
  blockingRuleCount!: number;

  @Column({ name: 'warning_rule_count', type: 'int', unsigned: true, default: 0 })
  warningRuleCount!: number;

  @Column({ type: 'text' })
  summary!: string;

  @Column({ name: 'gross_exposure_delta', type: 'double', nullable: true })
  grossExposureDelta!: number | null;

  @Column({ name: 'net_exposure_delta', type: 'double', nullable: true })
  netExposureDelta!: number | null;

  @Column({ name: 'open_order_exposure_delta', type: 'double', nullable: true })
  openOrderExposureDelta!: number | null;

  @Column({ name: 'reserved_order_margin_delta', type: 'double', nullable: true })
  reservedOrderMarginDelta!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
