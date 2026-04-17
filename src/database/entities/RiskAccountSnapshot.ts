import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'risk_account_snapshots' })
@Index('idx_risk_account_snapshots_snapshot_id', ['snapshotId'])
@Index('idx_risk_account_snapshots_user_created_at', ['userId', 'createdAt'])
@Index('idx_risk_account_snapshots_user_account_created_at', ['userId', 'accountId', 'createdAt'])
export class RiskAccountSnapshot {
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

  @Column({ name: 'denominator_basis', type: 'varchar', length: 50, nullable: true })
  denominatorBasis!: string | null;

  @Column({ name: 'wallet_balance', type: 'double', nullable: true })
  walletBalance!: number | null;

  @Column({ name: 'futures_balance', type: 'double', nullable: true })
  futuresBalance!: number | null;

  @Column({ name: 'tracked_balance', type: 'double', nullable: true })
  trackedBalance!: number | null;

  @Column({ name: 'gross_exposure', type: 'double', default: 0 })
  grossExposure!: number;

  @Column({ name: 'net_exposure', type: 'double', default: 0 })
  netExposure!: number;

  @Column({ name: 'long_exposure', type: 'double', default: 0 })
  longExposure!: number;

  @Column({ name: 'short_exposure', type: 'double', default: 0 })
  shortExposure!: number;

  @Column({ name: 'open_orders', type: 'int', unsigned: true, default: 0 })
  openOrders!: number;

  @Column({ name: 'open_order_exposure', type: 'double', default: 0 })
  openOrderExposure!: number;

  @Column({ name: 'reserved_order_margin', type: 'double', default: 0 })
  reservedOrderMargin!: number;

  @Column({ name: 'margin_usage_pct', type: 'double', default: 0 })
  marginUsagePct!: number;

  @Column({ name: 'portfolio_concentration_pct', type: 'double', default: 0 })
  portfolioConcentrationPct!: number;

  @Column({ name: 'daily_loss_usage_pct', type: 'double', default: 0 })
  dailyLossUsagePct!: number;

  @Column({ name: 'unrealized_pnl', type: 'double', default: 0 })
  unrealizedPnl!: number;

  @Column({ name: 'open_positions', type: 'int', unsigned: true, default: 0 })
  openPositions!: number;

  @Column({ name: 'max_position_leverage', type: 'double', nullable: true })
  maxPositionLeverage!: number | null;

  @Column({ name: 'closest_liquidation_distance_pct', type: 'double', nullable: true })
  closestLiquidationDistancePct!: number | null;

  @Column({ name: 'margin_usage_warn_pct', type: 'double', default: 0 })
  marginUsageWarnPct!: number;

  @Column({ name: 'margin_usage_critical_pct', type: 'double', default: 0 })
  marginUsageCriticalPct!: number;

  @Column({ name: 'concentration_warn_pct', type: 'double', default: 0 })
  concentrationWarnPct!: number;

  @Column({ name: 'concentration_critical_pct', type: 'double', default: 0 })
  concentrationCriticalPct!: number;

  @Column({ name: 'daily_loss_limit_pct', type: 'double', default: 0 })
  dailyLossLimitPct!: number;

  @Column({ name: 'weekly_loss_limit_pct', type: 'double', default: 0 })
  weeklyLossLimitPct!: number;

  @Column({ name: 'monthly_loss_limit_pct', type: 'double', default: 0 })
  monthlyLossLimitPct!: number;

  @Column({ name: 'max_leverage', type: 'double', default: 0 })
  maxLeverage!: number;

  @Column({ name: 'max_total_allocation', type: 'double', default: 0 })
  maxTotalAllocation!: number;

  @Column({ name: 'max_avg_leverage', type: 'double', default: 0 })
  maxAvgLeverage!: number;

  @Column({ name: 'funds_observed_at', type: 'timestamp', nullable: true })
  fundsObservedAt!: Date | null;

  @Column({ name: 'positions_observed_at', type: 'timestamp', nullable: true })
  positionsObservedAt!: Date | null;

  @Column({ name: 'orders_observed_at', type: 'timestamp', nullable: true })
  ordersObservedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
