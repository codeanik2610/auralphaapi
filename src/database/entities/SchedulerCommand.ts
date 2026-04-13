import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'scheduler_commands' })
@Index('idx_scheduler_commands_status_created_at', ['status', 'createdAt'])
@Index('idx_scheduler_commands_scheduler_key_status', ['schedulerKey', 'status'])
@Index('idx_scheduler_commands_scheduler_actor_status', ['schedulerKey', 'actorUserId', 'status'])
@Index('idx_scheduler_commands_status_claimed_at', ['status', 'claimedAt'])
@Index('idx_scheduler_commands_worker_status_claimed_at', ['workerId', 'status', 'claimedAt'])
export class SchedulerCommand {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'scheduler_key', type: 'varchar', length: 100 })
  schedulerKey!: string;

  @Column({ name: 'command_type', type: 'varchar', length: 50 })
  commandType!: string;

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

  @Column({ name: 'payload_json', type: 'simple-json', nullable: true })
  payload!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 30, default: 'Pending' })
  status!: string;

  @Column({ name: 'worker_id', type: 'varchar', length: 191, nullable: true })
  workerId!: string | null;

  @Column({ name: 'claimed_at', type: 'timestamp', nullable: true })
  claimedAt!: Date | null;

  @Column({ name: 'processed_at', type: 'timestamp', nullable: true })
  processedAt!: Date | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'repaired_at', type: 'timestamp', nullable: true })
  repairedAt!: Date | null;

  @Column({ name: 'repair_reason', type: 'text', nullable: true })
  repairReason!: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt!: Date;
}
