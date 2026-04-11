import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'scheduler_run_logs' })
@Index('idx_scheduler_run_logs_key_started', ['schedulerKey', 'startedAt'])
@Index('idx_scheduler_run_logs_scheduler_actor_started', ['schedulerKey', 'actorUserId', 'startedAt'])
export class SchedulerRunLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'scheduler_key', type: 'varchar', length: 100 })
  schedulerKey!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ name: 'actor_user_id', type: 'varchar', length: 191, nullable: true })
  actorUserId!: string | null;

  @Column({ name: 'initiated_by_type', type: 'varchar', length: 32, nullable: true })
  initiatedByType!: string | null;

  @Column({ name: 'initiated_by_user_id', type: 'varchar', length: 191, nullable: true })
  initiatedByUserId!: string | null;

  @Column({ name: 'initiated_by_label', type: 'varchar', length: 191, nullable: true })
  initiatedByLabel!: string | null;

  @Column({ name: 'execution_context', type: 'varchar', length: 32, nullable: true })
  executionContext!: string | null;

  @Column({ name: 'started_at', type: 'timestamp' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamp', nullable: true })
  finishedAt!: Date | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs!: number | null;

  @Column({ name: 'processed_accounts', type: 'int', default: 0 })
  processedAccounts!: number;

  @Column({ name: 'inserted_assets', type: 'int', default: 0 })
  insertedAssets!: number;

  @Column({ name: 'updated_assets', type: 'int', default: 0 })
  updatedAssets!: number;

  @Column({ name: 'skipped_assets', type: 'int', default: 0 })
  skippedAssets!: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'meta_json', type: 'simple-json', nullable: true })
  meta!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;
}
