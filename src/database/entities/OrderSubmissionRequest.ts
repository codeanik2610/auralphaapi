import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'order_submission_requests' })
@Unique('uq_order_submission_requests_user_key', ['userId', 'idempotencyKey'])
@Index('idx_order_submission_requests_user_status_updated_at', ['userId', 'status', 'updatedAt'])
export class OrderSubmissionRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 191 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ name: 'execution_mode', type: 'varchar', length: 32 })
  executionMode!: string;

  @Column({ name: 'asset_id', type: 'varchar', length: 191 })
  assetId!: string;

  @Column({ name: 'broker_key', type: 'varchar', length: 100, nullable: true })
  brokerKey!: string | null;

  @Column({ name: 'account_id', type: 'char', length: 36, nullable: true })
  accountId!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'in_progress' })
  status!: 'in_progress' | 'completed' | 'failed';

  @Column({ name: 'response_json', type: 'json', nullable: true })
  responsePayload!: Record<string, unknown> | null;

  @Column({ name: 'error_json', type: 'json', nullable: true })
  errorPayload!: Record<string, unknown> | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamp', nullable: true })
  failedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
