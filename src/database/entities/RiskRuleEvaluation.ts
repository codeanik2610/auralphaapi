import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'risk_rule_evaluations' })
@Index('idx_risk_rule_evaluations_snapshot_id', ['snapshotId'])
@Index('idx_risk_rule_evaluations_snapshot_scope', ['snapshotId', 'scopeType', 'scopeKey'])
@Index('idx_risk_rule_evaluations_user_source_created_at', ['userId', 'sourceType', 'createdAt'])
@Index('idx_risk_rule_evaluations_snapshot_alert_severity', ['snapshotId', 'alertSeverity', 'createdAt'])
export class RiskRuleEvaluation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'snapshot_id', type: 'char', length: 36 })
  snapshotId!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ name: 'policy_context_id', type: 'char', length: 36, nullable: true })
  policyContextId!: string | null;

  @Column({ name: 'source_type', type: 'varchar', length: 40 })
  sourceType!: string;

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

  @Column({ name: 'position_id', type: 'varchar', length: 191, nullable: true })
  positionId!: string | null;

  @Column({ name: 'symbol', type: 'varchar', length: 100, nullable: true })
  symbol!: string | null;

  @Column({ name: 'rule_code', type: 'varchar', length: 120 })
  ruleCode!: string;

  @Column({ name: 'metric_name', type: 'varchar', length: 120, nullable: true })
  metricName!: string | null;

  @Column({ name: 'actual_value', type: 'double', nullable: true })
  actualValue!: number | null;

  @Column({ name: 'basis_value', type: 'double', nullable: true })
  basisValue!: number | null;

  @Column({ name: 'warn_threshold_value', type: 'double', nullable: true })
  warnThresholdValue!: number | null;

  @Column({ name: 'critical_threshold_value', type: 'double', nullable: true })
  criticalThresholdValue!: number | null;

  @Column({ name: 'status', type: 'varchar', length: 20 })
  status!: string;

  @Column({ name: 'bucket', type: 'varchar', length: 255, nullable: true })
  bucket!: string | null;

  @Column({ name: 'exposure', type: 'varchar', length: 120, nullable: true })
  exposure!: string | null;

  @Column({ name: 'threshold', type: 'varchar', length: 255, nullable: true })
  threshold!: string | null;

  @Column({ name: 'action', type: 'text', nullable: true })
  action!: string | null;

  @Column({ name: 'alert_severity', type: 'varchar', length: 20, nullable: true })
  alertSeverity!: string | null;

  @Column({ name: 'alert_message', type: 'text', nullable: true })
  alertMessage!: string | null;

  @Column({ name: 'alert_symbol', type: 'varchar', length: 100, nullable: true })
  alertSymbol!: string | null;

  @Column({ name: 'alert_channel', type: 'varchar', length: 100, nullable: true })
  alertChannel!: string | null;

  @Column({ name: 'alert_status', type: 'varchar', length: 40, nullable: true })
  alertStatus!: string | null;

  @Column({ name: 'sort_order', type: 'int', unsigned: true, default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
