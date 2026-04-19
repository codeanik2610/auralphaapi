import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'risk_snapshot_policy_contexts' })
@Index('idx_risk_snapshot_policy_contexts_snapshot_id', ['snapshotId'])
@Index('uidx_risk_snapshot_policy_contexts_snapshot_context_key', ['snapshotId', 'contextKey'], {
  unique: true,
})
@Index('idx_risk_snapshot_policy_contexts_user_scope_created_at', ['userId', 'policyScope', 'createdAt'])
export class RiskSnapshotPolicyContext {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'snapshot_id', type: 'char', length: 36 })
  snapshotId!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ name: 'context_key', type: 'varchar', length: 191 })
  contextKey!: string;

  @Column({ name: 'policy_id', type: 'char', length: 36, nullable: true })
  policyId!: string | null;

  @Column({ name: 'policy_scope', type: 'varchar', length: 20 })
  policyScope!: string;

  @Column({ name: 'policy_target_key', type: 'varchar', length: 191 })
  policyTargetKey!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ name: 'monitor_only', type: 'boolean', default: true })
  monitorOnly!: boolean;

  @Column({ name: 'enforce_hard_block', type: 'boolean', default: false })
  enforceHardBlock!: boolean;

  @Column({ name: 'margin_usage_warn_pct', type: 'double', default: 70 })
  marginUsageWarnPct!: number;

  @Column({ name: 'margin_usage_critical_pct', type: 'double', default: 85 })
  marginUsageCriticalPct!: number;

  @Column({ name: 'concentration_warn_pct', type: 'double', default: 30 })
  concentrationWarnPct!: number;

  @Column({ name: 'concentration_critical_pct', type: 'double', default: 45 })
  concentrationCriticalPct!: number;

  @Column({ name: 'daily_loss_limit_pct', type: 'double', default: 5 })
  dailyLossLimitPct!: number;

  @Column({ name: 'weekly_loss_limit_pct', type: 'double', default: 12 })
  weeklyLossLimitPct!: number;

  @Column({ name: 'monthly_loss_limit_pct', type: 'double', default: 20 })
  monthlyLossLimitPct!: number;

  @Column({ name: 'min_leverage', type: 'double', nullable: true })
  minLeverage!: number | null;

  @Column({ name: 'max_leverage', type: 'double', nullable: true })
  maxLeverage!: number | null;

  @Column({ name: 'min_notional_per_trade', type: 'double', nullable: true })
  minNotionalPerTrade!: number | null;

  @Column({ name: 'max_order_allocation', type: 'double', nullable: true })
  maxOrderAllocation!: number | null;

  @Column({ name: 'max_total_allocation', type: 'double', nullable: true })
  maxTotalAllocation!: number | null;

  @Column({ name: 'max_avg_leverage', type: 'double', nullable: true })
  maxAvgLeverage!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
