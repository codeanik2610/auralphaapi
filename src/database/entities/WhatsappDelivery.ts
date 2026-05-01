import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'whatsapp_deliveries' })
@Index('idx_whatsapp_deliveries_status_created_at', ['status', 'createdAt'])
@Index('idx_whatsapp_deliveries_status_updated_at', ['status', 'updatedAt'])
@Index('idx_whatsapp_deliveries_user_created_at', ['userId', 'createdAt'])
@Index('uidx_whatsapp_deliveries_dedupe_key', ['dedupeKey'], { unique: true })
export class WhatsappDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ name: 'suggested_trade_id', type: 'char', length: 36, nullable: true })
  suggestedTradeId!: string | null;

  @Column({ name: 'automation_id', type: 'char', length: 36, nullable: true })
  automationId!: string | null;

  @Column({ name: 'automation_run_id', type: 'char', length: 36, nullable: true })
  automationRunId!: string | null;

  @Column({ name: 'recipient_phone', type: 'varchar', length: 32 })
  recipientPhone!: string;

  @Column({ name: 'template_key', type: 'varchar', length: 64 })
  templateKey!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'varchar', length: 32, default: 'whatsapp' })
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

  @Column({ name: 'dedupe_key', type: 'varchar', length: 191, nullable: true })
  dedupeKey!: string | null;

  @Column({ name: 'provider_message_id', type: 'varchar', length: 191, nullable: true })
  providerMessageId!: string | null;

  @Column({ name: 'sent_at', type: 'timestamp', nullable: true })
  sentAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
