import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// Phase 1 schema foundation for dedicated system-health-sync check storage.
@Entity({ name: 'scheduler_health_check_results' })
@Index('idx_scheduler_health_check_results_run_created', ['runLogId', 'createdAt'])
@Index('idx_scheduler_health_check_results_status_created', ['status', 'createdAt'])
export class SchedulerHealthCheckResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'run_log_id', type: 'char', length: 36 })
  runLogId!: string;

  @Column({ name: 'check_id', type: 'varchar', length: 100 })
  checkId!: string;

  @Column({ name: 'check_label', type: 'varchar', length: 191 })
  checkLabel!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ type: 'text', nullable: true })
  detail!: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;
}
