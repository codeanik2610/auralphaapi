import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'risk_request_scope_impacts' })
@Index('idx_risk_request_scope_impacts_check_id', ['checkId'])
@Index('idx_risk_request_scope_impacts_check_scope', ['checkId', 'scopeType', 'scopeKey'])
export class RiskRequestScopeImpact {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'check_id', type: 'char', length: 36 })
  checkId!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ name: 'snapshot_id', type: 'char', length: 36, nullable: true })
  snapshotId!: string | null;

  @Column({ name: 'scope_type', type: 'varchar', length: 40 })
  scopeType!: string;

  @Column({ name: 'scope_key', type: 'varchar', length: 191 })
  scopeKey!: string;

  @Column({ name: 'scope_label', type: 'varchar', length: 255, nullable: true })
  scopeLabel!: string | null;

  @Column({ name: 'broker_key', type: 'varchar', length: 100, nullable: true })
  brokerKey!: string | null;

  @Column({ name: 'account_id', type: 'varchar', length: 191, nullable: true })
  accountId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  symbol!: string | null;

  @Column({ name: 'before_gross_exposure', type: 'double', nullable: true })
  beforeGrossExposure!: number | null;

  @Column({ name: 'before_net_exposure', type: 'double', nullable: true })
  beforeNetExposure!: number | null;

  @Column({ name: 'before_open_order_exposure', type: 'double', nullable: true })
  beforeOpenOrderExposure!: number | null;

  @Column({ name: 'before_reserved_order_margin', type: 'double', nullable: true })
  beforeReservedOrderMargin!: number | null;

  @Column({ name: 'before_margin_usage_pct', type: 'double', nullable: true })
  beforeMarginUsagePct!: number | null;

  @Column({ name: 'before_allocation_pct', type: 'double', nullable: true })
  beforeAllocationPct!: number | null;

  @Column({ name: 'before_risk_score', type: 'double', nullable: true })
  beforeRiskScore!: number | null;

  @Column({ name: 'before_risk_state', type: 'varchar', length: 20, nullable: true })
  beforeRiskState!: string | null;

  @Column({ name: 'delta_gross_exposure', type: 'double', nullable: true })
  deltaGrossExposure!: number | null;

  @Column({ name: 'delta_net_exposure', type: 'double', nullable: true })
  deltaNetExposure!: number | null;

  @Column({ name: 'delta_open_order_exposure', type: 'double', nullable: true })
  deltaOpenOrderExposure!: number | null;

  @Column({ name: 'delta_reserved_order_margin', type: 'double', nullable: true })
  deltaReservedOrderMargin!: number | null;

  @Column({ name: 'after_gross_exposure', type: 'double', nullable: true })
  afterGrossExposure!: number | null;

  @Column({ name: 'after_net_exposure', type: 'double', nullable: true })
  afterNetExposure!: number | null;

  @Column({ name: 'after_open_order_exposure', type: 'double', nullable: true })
  afterOpenOrderExposure!: number | null;

  @Column({ name: 'after_reserved_order_margin', type: 'double', nullable: true })
  afterReservedOrderMargin!: number | null;

  @Column({ name: 'after_margin_usage_pct', type: 'double', nullable: true })
  afterMarginUsagePct!: number | null;

  @Column({ name: 'after_allocation_pct', type: 'double', nullable: true })
  afterAllocationPct!: number | null;

  @Column({ name: 'after_risk_score', type: 'double', nullable: true })
  afterRiskScore!: number | null;

  @Column({ name: 'after_risk_state', type: 'varchar', length: 20, nullable: true })
  afterRiskState!: string | null;

  @Column({ name: 'sort_order', type: 'int', unsigned: true, default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
