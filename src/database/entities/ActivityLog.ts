import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'activity_logs' })
@Index('idx_activity_logs_stream_created_at', ['stream', 'createdAt'])
@Index('idx_activity_logs_status_created_at', ['status', 'createdAt'])
@Index('idx_activity_logs_user_created_at', ['userId', 'createdAt'])
@Index('idx_activity_logs_user_stream_created_at', ['userId', 'stream', 'createdAt'])
@Index('idx_activity_logs_user_status_created_at', ['userId', 'status', 'createdAt'])
@Index('idx_activity_logs_user_read_created_at', ['userId', 'readAt', 'createdAt'])
@Index('idx_activity_logs_user_type_created_at', ['userId', 'type', 'createdAt'])
@Index('idx_activity_logs_user_symbol_created_at', ['userId', 'symbol', 'createdAt'])
@Index('idx_activity_logs_user_correlation_created_at', ['userId', 'correlationId', 'createdAt'])
@Index('idx_activity_logs_user_route_created_at', ['userId', 'route', 'createdAt'])
@Index('idx_activity_logs_user_reference_created_at', ['userId', 'referenceId', 'createdAt'])
@Index('idx_activity_logs_user_related_created_at', ['userId', 'related', 'createdAt'])
export class ActivityLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50 })
  type!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'varchar', length: 30 })
  status!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  actor!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  symbol!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  route!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  referenceId!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  stream!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  related!: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 191, nullable: true })
  correlationId!: string | null;

  @Column({ type: 'json', nullable: true })
  flags!: Array<{
    id: string;
    message: string;
    channel: string;
    time: string;
    status: string;
  }> | null;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ name: 'read_at', type: 'timestamp', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
