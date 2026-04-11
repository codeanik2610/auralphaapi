import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'email_deliveries' })
@Index('idx_email_deliveries_status_created_at', ['status', 'createdAt'])
@Index('idx_email_deliveries_status_updated_at', ['status', 'updatedAt'])
@Index('idx_email_deliveries_user_created_at', ['userId', 'createdAt'])
@Index('idx_email_deliveries_channel_created_at', ['channel', 'createdAt'])
@Index('idx_email_deliveries_severity_created_at', ['severity', 'createdAt'])
export class EmailDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ name: 'alert_id', type: 'char', length: 36, nullable: true })
  alertId!: string | null;

  @Column({ name: 'recipient_email', type: 'varchar', length: 191 })
  recipientEmail!: string;

  @Column({ type: 'varchar', length: 255 })
  subject!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'varchar', length: 50 })
  channel!: string;

  @Column({ type: 'varchar', length: 20 })
  severity!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  route!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  source!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'Queued' })
  status!: string;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
