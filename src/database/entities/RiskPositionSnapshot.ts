import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'risk_position_snapshots' })
@Index('idx_risk_position_snapshots_snapshot_id', ['snapshotId'])
@Index('idx_risk_position_snapshots_user_created_at', ['userId', 'createdAt'])
@Index('idx_risk_position_snapshots_user_account_created_at', ['userId', 'accountId', 'createdAt'])
export class RiskPositionSnapshot {
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

  @Column({ name: 'position_id', type: 'varchar', length: 191 })
  positionId!: string;

  @Column({ type: 'varchar', length: 100 })
  symbol!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  side!: string | null;

  @Column({ name: 'side_key', type: 'varchar', length: 20, nullable: true })
  sideKey!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  status!: string | null;

  @Column({ name: 'status_key', type: 'varchar', length: 20, nullable: true })
  statusKey!: string | null;

  @Column({ type: 'double', nullable: true })
  quantity!: number | null;

  @Column({ name: 'entry_price', type: 'double', nullable: true })
  entryPrice!: number | null;

  @Column({ name: 'current_price', type: 'double', nullable: true })
  currentPrice!: number | null;

  @Column({ type: 'double', default: 0 })
  exposure!: number;

  @Column({ name: 'unrealized_pnl', type: 'double', nullable: true })
  unrealizedPnl!: number | null;

  @Column({ name: 'realized_pnl', type: 'double', nullable: true })
  realizedPnl!: number | null;

  @Column({ type: 'double', nullable: true })
  leverage!: number | null;

  @Column({ name: 'requested_leverage', type: 'double', nullable: true })
  requestedLeverage!: number | null;

  @Column({ name: 'confirmed_order_leverage', type: 'double', nullable: true })
  confirmedOrderLeverage!: number | null;

  @Column({ name: 'observed_position_leverage', type: 'double', nullable: true })
  observedPositionLeverage!: number | null;

  @Column({ name: 'leverage_source', type: 'varchar', length: 64, nullable: true })
  leverageSource!: string | null;

  @Column({ name: 'liquidation_price', type: 'double', nullable: true })
  liquidationPrice!: number | null;

  @Column({ name: 'liquidation_distance_pct', type: 'double', nullable: true })
  liquidationDistancePct!: number | null;

  @Column({ name: 'concentration_pct', type: 'double', nullable: true })
  concentrationPct!: number | null;

  @Column({ name: 'risk_state', type: 'varchar', length: 20 })
  riskState!: string;

  @Column({ name: 'risk_notes_json', type: 'json', nullable: true })
  riskNotesJson!: string[] | null;

  @Column({ name: 'position_opened_at', type: 'timestamp', nullable: true })
  positionOpenedAt!: Date | null;

  @Column({ name: 'source_updated_at', type: 'timestamp', nullable: true })
  sourceUpdatedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
