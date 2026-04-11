import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'automation_cursors' })
@Index('uidx_automation_cursors_automation_symbol_timeframe', ['automationId', 'symbol', 'timeframe'], {
  unique: true,
})
@Index('idx_automation_cursors_user_updated_at', ['userId', 'updatedAt'])
export class AutomationCursor {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'automation_id', type: 'char', length: 36 })
  automationId!: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId!: string;

  @Column({ type: 'varchar', length: 64 })
  symbol!: string;

  @Column({ type: 'varchar', length: 16 })
  timeframe!: string;

  @Column({ name: 'last_evaluated_signal_time', type: 'timestamp', nullable: true })
  lastEvaluatedSignalTime!: Date | null;

  @Column({ name: 'last_triggered_signal_time', type: 'timestamp', nullable: true })
  lastTriggeredSignalTime!: Date | null;

  @Column({ name: 'last_run_id', type: 'char', length: 36, nullable: true })
  lastRunId!: string | null;

  @Column({ name: 'last_status', type: 'varchar', length: 32, nullable: true })
  lastStatus!: string | null;

  @Column({ name: 'meta_json', type: 'json', nullable: true })
  meta!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
