import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'broker_accounts' })
@Index('idx_broker_accounts_user_connection_updated_at', ['userId', 'connectionId', 'updatedAt'])
@Index('idx_broker_accounts_user_status_updated_at', ['userId', 'status', 'updatedAt'])
@Index('uidx_broker_accounts_user_account_key', ['userId', 'accountKey'], { unique: true })
export class BrokerAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'user_id', nullable: true })
  userId!: string | null;

  @Column({ type: 'varchar', length: 36 })
  connectionId!: string;

  @Column({ type: 'varchar', length: 100 })
  brokerKey!: string;

  @Column({ name: 'broker_id', type: 'char', length: 36, nullable: true })
  brokerId!: string | null;

  @Column({ type: 'varchar', length: 100 })
  accountKey!: string;

  @Column({ type: 'varchar', length: 255 })
  accountName!: string;

  @Column({ type: 'varchar', length: 30 })
  status!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  mode!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastSyncAt!: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  purpose!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  capabilities!: string | null;

  @Column({ type: 'json', nullable: true })
  settings!: Record<string, unknown> | null;

  @Column({ type: 'boolean', default: false })
  isDefault!: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
