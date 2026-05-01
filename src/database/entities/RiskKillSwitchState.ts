import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'risk_kill_switch_states' })
@Index('idx_risk_kill_switch_states_user_active', ['userId', 'active'])
@Index('idx_risk_kill_switch_states_user_scope', ['userId', 'scope'])
@Index('idx_risk_kill_switch_states_user_broker', ['userId', 'brokerKey'])
export class RiskKillSwitchState {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ type: 'varchar', length: 32 })
  scope!: string;

  @Column({ name: 'broker_key', type: 'varchar', length: 100, nullable: true })
  brokerKey!: string | null;

  @Column({ name: 'account_id', type: 'varchar', length: 191, nullable: true })
  accountId!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'varchar', length: 500 })
  reason!: string;

  @Column({ name: 'triggered_by', type: 'varchar', length: 191 })
  triggeredBy!: string;

  @Column({ name: 'triggered_at', type: 'timestamp' })
  triggeredAt!: Date;

  @Column({ name: 'cleared_by', type: 'varchar', length: 191, nullable: true })
  clearedBy!: string | null;

  @Column({ name: 'cleared_at', type: 'timestamp', nullable: true })
  clearedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
