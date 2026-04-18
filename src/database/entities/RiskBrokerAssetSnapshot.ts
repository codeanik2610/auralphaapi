import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'risk_broker_asset_snapshots' })
@Index('idx_risk_broker_asset_snapshots_snapshot_id', ['snapshotId'])
@Index('uidx_risk_broker_asset_snapshots_snapshot_broker_symbol', ['snapshotId', 'brokerKey', 'symbol'], {
  unique: true,
})
@Index('idx_risk_broker_asset_snapshots_snapshot_risk_state_score', ['snapshotId', 'riskState', 'riskScore'])
export class RiskBrokerAssetSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'snapshot_id', type: 'char', length: 36 })
  snapshotId!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ name: 'broker_key', type: 'varchar', length: 100 })
  brokerKey!: string;

  @Column({ type: 'varchar', length: 100 })
  symbol!: string;

  @Column({ name: 'policy_context_id', type: 'char', length: 36, nullable: true })
  policyContextId!: string | null;

  @Column({ name: 'account_count', type: 'int', unsigned: true, default: 0 })
  accountCount!: number;

  @Column({ name: 'position_count', type: 'int', unsigned: true, default: 0 })
  positionCount!: number;

  @Column({ name: 'open_orders', type: 'int', unsigned: true, default: 0 })
  openOrders!: number;

  @Column({ name: 'open_order_exposure', type: 'double', default: 0 })
  openOrderExposure!: number;

  @Column({ name: 'reserved_order_margin', type: 'double', default: 0 })
  reservedOrderMargin!: number;

  @Column({ name: 'gross_exposure', type: 'double', default: 0 })
  grossExposure!: number;

  @Column({ name: 'net_exposure', type: 'double', default: 0 })
  netExposure!: number;

  @Column({ name: 'long_exposure', type: 'double', default: 0 })
  longExposure!: number;

  @Column({ name: 'short_exposure', type: 'double', default: 0 })
  shortExposure!: number;

  @Column({ name: 'unrealized_pnl', type: 'double', default: 0 })
  unrealizedPnl!: number;

  @Column({ name: 'realized_pnl', type: 'double', default: 0 })
  realizedPnl!: number;

  @Column({ name: 'weighted_avg_leverage', type: 'double', nullable: true })
  weightedAvgLeverage!: number | null;

  @Column({ name: 'max_leverage', type: 'double', nullable: true })
  maxLeverage!: number | null;

  @Column({ name: 'worst_liquidation_distance_pct', type: 'double', nullable: true })
  worstLiquidationDistancePct!: number | null;

  @Column({ name: 'risk_score', type: 'int', unsigned: true, default: 0 })
  riskScore!: number;

  @Column({ name: 'risk_state', type: 'varchar', length: 20, default: 'ok' })
  riskState!: string;

  @Column({ name: 'primary_concern', type: 'varchar', length: 255, nullable: true })
  primaryConcern!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
