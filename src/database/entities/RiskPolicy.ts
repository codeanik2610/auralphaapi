import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';

@Entity({ name: 'risk_policies' })
@Index('idx_risk_policies_user_scope', ['userId', 'scope'])
@Index('idx_risk_policies_user_broker', ['userId', 'brokerKey'])
@Index('idx_risk_policies_user_account', ['userId', 'accountId'])
@Index('uidx_risk_policies_user_target_key', ['userId', 'normalizedTargetKey'], { unique: true })
export class RiskPolicy {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ type: 'varchar', length: 20 })
  scope!: string;

  @Column({ name: 'broker_key', type: 'varchar', length: 100, nullable: true })
  brokerKey!: string | null;

  @Column({ name: 'account_id', type: 'varchar', length: 191, nullable: true })
  accountId!: string | null;

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

  @Column({ name: 'max_leverage', type: 'double', nullable: true })
  maxLeverage!: number | null;

  @Column({ name: 'max_order_allocation', type: 'double', nullable: true })
  maxOrderAllocation!: number | null;

  @Column({ name: 'max_total_allocation', type: 'double', nullable: true })
  maxTotalAllocation!: number | null;

  @Column({ name: 'max_avg_leverage', type: 'double', nullable: true })
  maxAvgLeverage!: number | null;

  @Column({
    name: 'normalized_target_key',
    type: 'varchar',
    length: 255,
    nullable: true,
    select: false,
    asExpression:
      "CASE WHEN `scope` = 'user' THEN '__user__' WHEN `scope` = 'broker' THEN CONCAT('broker::', LOWER(TRIM(COALESCE(`broker_key`, '')))) ELSE CONCAT('__invalid__::', LOWER(TRIM(COALESCE(`scope`, '')))) END",
    generatedType: 'STORED',
  })
  normalizedTargetKey!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
