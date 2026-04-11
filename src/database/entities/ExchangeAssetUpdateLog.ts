import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'exchange_asset_update_logs' })
@Index('idx_exchange_asset_update_logs_run_created', ['runLogId', 'createdAt'])
@Index('idx_exchange_asset_update_logs_source_symbol', ['source', 'symbol'])
export class ExchangeAssetUpdateLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'run_log_id', type: 'char', length: 36 })
  runLogId!: string;

  @Column({ name: 'initiated_by_type', type: 'varchar', length: 32, nullable: true })
  initiatedByType!: string | null;

  @Column({ name: 'initiated_by_user_id', type: 'varchar', length: 191, nullable: true })
  initiatedByUserId!: string | null;

  @Column({ name: 'initiated_by_label', type: 'varchar', length: 191, nullable: true })
  initiatedByLabel!: string | null;

  @Column({ name: 'execution_context', type: 'varchar', length: 32, nullable: true })
  executionContext!: string | null;

  @Column({ type: 'varchar', length: 64 })
  source!: string;

  @Column({ name: 'account_id', type: 'char', length: 36, nullable: true })
  accountId!: string | null;

  @Column({ name: 'connection_id', type: 'char', length: 36, nullable: true })
  connectionId!: string | null;

  @Column({ name: 'action_type', type: 'varchar', length: 32 })
  actionType!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  symbol!: string | null;

  @Column({ name: 'external_id', type: 'varchar', length: 255, nullable: true })
  externalId!: string | null;

  @Column({ name: 'asset_id', type: 'varchar', length: 36, nullable: true })
  assetId!: string | null;

  @Column({ name: 'message', type: 'varchar', length: 255, nullable: true })
  message!: string | null;

  @Column({ name: 'detail_json', type: 'simple-json', nullable: true })
  detail!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;
}
