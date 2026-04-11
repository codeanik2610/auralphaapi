import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Alert } from './Alert';

@Entity({ name: 'alert_actions' })
@Index('idx_alert_actions_alert_created_at', ['alertId', 'createdAt'])
export class AlertAction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36 })
  alertId!: string;

  @Column({ type: 'varchar', length: 30 })
  actionType!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  target!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  actor!: string | null;

  @Column({ type: 'json', nullable: true })
  metadata!: Record<string, unknown> | null;

  @ManyToOne(() => Alert, (alert) => alert.actions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'alertId' })
  alert!: Alert;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;
}
