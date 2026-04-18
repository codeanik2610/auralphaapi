import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'risk_request_rule_evaluations' })
@Index('idx_risk_request_rule_evaluations_check_id', ['checkId'])
@Index('idx_risk_request_rule_evaluations_check_scope', ['checkId', 'scopeType', 'scopeKey'])
@Index('idx_risk_request_rule_evaluations_check_status', ['checkId', 'status', 'blocking'])
export class RiskRequestRuleEvaluation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'check_id', type: 'char', length: 36 })
  checkId!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ name: 'snapshot_id', type: 'char', length: 36, nullable: true })
  snapshotId!: string | null;

  @Column({ name: 'policy_context_id', type: 'char', length: 36, nullable: true })
  policyContextId!: string | null;

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

  @Column({ type: 'varchar', length: 20 })
  status!: string;

  @Column({ type: 'boolean', default: false })
  blocking!: boolean;

  @Column({ type: 'text' })
  message!: string;

  @Column({ name: 'sort_order', type: 'int', unsigned: true, default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
