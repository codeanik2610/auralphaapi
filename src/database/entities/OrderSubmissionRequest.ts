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
@Index('idx_order_submission_requests_suggested_trade', [
  'userId',
  'suggestedTradeId',
  'createdAt',
])
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

  @Column({ name: 'suggested_trade_id', type: 'char', length: 36, nullable: true })
  suggestedTradeId!: string | null;

  @Column({ name: 'request_json', type: 'json', nullable: true })
  requestPayload!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 32, default: 'in_progress' })
  status!: 'in_progress' | 'completed' | 'failed';

  @Column({ name: 'placement_state', type: 'varchar', length: 32, default: 'registered' })
  placementState!: 'registered' | 'submitting' | 'placed' | 'rejected' | 'replayed';

  @Column({ name: 'broker_order_id', type: 'varchar', length: 191, nullable: true })
  brokerOrderId!: string | null;

  @Column({ name: 'broker_order_status', type: 'varchar', length: 64, nullable: true })
  brokerOrderStatus!: string | null;

  @Column({ name: 'reconciliation_state', type: 'varchar', length: 32, default: 'not_required' })
  reconciliationState!: 'not_required' | 'pending' | 'matched' | 'missing';

  @Column({ name: 'response_json', type: 'json', nullable: true })
  responsePayload!: Record<string, unknown> | null;

  @Column({ name: 'error_json', type: 'json', nullable: true })
  errorPayload!: Record<string, unknown> | null;

  @Column({ name: 'lifecycle_json', type: 'json', nullable: true })
  lifecyclePayload!: Array<Record<string, unknown>> | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamp', nullable: true })
  failedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
