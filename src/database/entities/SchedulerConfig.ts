import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'scheduler_configs' })
@Index('uidx_scheduler_configs_key', ['key'], { unique: true })
export class SchedulerConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  key!: string;

  @Column({ type: 'varchar', length: 191 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ name: 'cron_expression', type: 'varchar', length: 64 })
  cronExpression!: string;

  @Column({ type: 'varchar', length: 64, default: 'Asia/Kolkata' })
  timezone!: string;

  @Column({ name: 'run_at', type: 'varchar', length: 5, default: '01:00' })
  runAt!: string;

  @Column({ name: 'interval_days', type: 'int', default: 1 })
  intervalDays!: number;

  @Column({ name: 'batch_size', type: 'int', default: 200 })
  batchSize!: number;

  @Column({ name: 'scheduler_type', type: 'varchar', length: 16, default: 'global' })
  schedulerType!: string;

  @Column({ type: 'simple-json', nullable: true })
  config!: Record<string, unknown> | null;

  @Column({ name: 'last_started_at', type: 'timestamp', nullable: true })
  lastStartedAt!: Date | null;

  @Column({ name: 'last_finished_at', type: 'timestamp', nullable: true })
  lastFinishedAt!: Date | null;

  @Column({ name: 'last_status', type: 'varchar', length: 32, nullable: true })
  lastStatus!: string | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'running_lock_until', type: 'timestamp', nullable: true })
  runningLockUntil!: Date | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt!: Date;
}
