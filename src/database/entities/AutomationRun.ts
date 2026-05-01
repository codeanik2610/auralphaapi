import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Automation } from './Automation';

@Entity({ name: 'automation_runs' })
@Index('idx_automation_runs_automation_started', ['automationId', 'startedAt'])
@Index('idx_automation_runs_user_started', ['userId', 'startedAt'])
@Index('idx_automation_runs_status_scheduled', ['status', 'scheduledFor'])
@Index('uidx_automation_runs_automation_scheduled', ['automationId', 'scheduledFor'], { unique: true })
@Index('idx_automation_runs_status_last_progress_at', ['status', 'lastProgressAt'])
@Index('idx_automation_runs_worker_status_started_at', ['workerId', 'status', 'startedAt'])
@Index('idx_automation_runs_status_started_at', ['status', 'startedAt'])
@Index('idx_automation_runs_user_status_started_at', ['userId', 'status', 'startedAt'])
export class AutomationRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'automation_id', type: 'char', length: 36 })
  automationId!: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ name: 'worker_id', type: 'varchar', length: 191, nullable: true })
  workerId!: string | null;

  @Column({ name: 'scheduled_for', type: 'timestamp', nullable: true })
  scheduledFor!: Date | null;

  @Column({ name: 'started_at', type: 'timestamp' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamp', nullable: true })
  finishedAt!: Date | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs!: number | null;

  @Column({ name: 'last_progress_at', type: 'timestamp', nullable: true })
  lastProgressAt!: Date | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'repaired_at', type: 'timestamp', nullable: true })
  repairedAt!: Date | null;

  @Column({ name: 'repair_reason', type: 'text', nullable: true })
  repairReason!: string | null;

  @Column({ name: 'meta_json', type: 'simple-json', nullable: true })
  meta!: Record<string, unknown> | null;

  @ManyToOne(() => Automation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'automation_id' })
  automation!: Automation;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;
}
