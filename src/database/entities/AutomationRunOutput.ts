import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'automation_run_outputs' })
@Index('idx_automation_run_outputs_run_created_at', ['automationRunId', 'createdAt'])
@Index('idx_automation_run_outputs_type_status', ['outputType', 'status'])
@Index('idx_automation_run_outputs_user_created_at', ['userId', 'createdAt'])
@Index('idx_automation_run_outputs_suggested_trade_id', ['suggestedTradeId'])
@Index(
  'uidx_automation_run_outputs_run_type_dedupe',
  ['automationRunId', 'outputType', 'dedupeKey'],
  { unique: true }
)
export class AutomationRunOutput {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'automation_id', type: 'char', length: 36 })
  automationId!: string;

  @Column({ name: 'automation_run_id', type: 'char', length: 36 })
  automationRunId!: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId!: string;

  @Column({ name: 'suggested_trade_id', type: 'char', length: 36, nullable: true })
  suggestedTradeId!: string | null;

  @Column({ name: 'output_type', type: 'varchar', length: 64 })
  outputType!: string;

  @Column({ type: 'varchar', length: 32, default: 'Created' })
  status!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title!: string | null;

  @Column({ name: 'dedupe_key', type: 'varchar', length: 191, nullable: true })
  dedupeKey!: string | null;

  @Column({ name: 'payload_json', type: 'json', nullable: true })
  payload!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
