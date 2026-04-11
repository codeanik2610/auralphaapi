import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'connections' })
@Index('idx_connections_user_type_updated_at', ['userId', 'type', 'updatedAt'])
@Index('idx_connections_user_status_updated_at', ['userId', 'status', 'updatedAt'])
export class Connection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'user_id', nullable: true })
  userId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  broker!: string | null;

  @Column({ type: 'varchar', length: 100 })
  brokerKey!: string;

  @Column({ name: 'broker_id', type: 'char', length: 36, nullable: true })
  brokerId!: string | null;

  @Column({ type: 'varchar', length: 30 })
  type!: string;

  @Column({ type: 'varchar', length: 30, default: 'Idle' })
  status!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  latency!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  mode!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastSyncAt!: Date | null;

  @Column({ name: 'diagnosticSummary', type: 'varchar', length: 255, nullable: true })
  diagnosticSummary!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  route!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  scope!: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
