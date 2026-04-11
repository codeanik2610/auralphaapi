import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'signal_alert_links' })
@Index('idx_signal_alert_links_signal_created_at', ['signalId', 'createdAt'])
@Index('idx_signal_alert_links_alert_created_at', ['alertId', 'createdAt'])
@Index('idx_signal_alert_links_user_signal_created_at', ['userId', 'signalId', 'createdAt'])
@Index('ux_signal_alert_links_signal_alert_relation', ['signalId', 'alertId', 'relationType'], {
  unique: true,
})
export class SignalAlertLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'signal_id', type: 'char', length: 36 })
  signalId!: string;

  @Column({ name: 'alert_id', type: 'char', length: 36 })
  alertId!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ name: 'relation_type', type: 'varchar', length: 30, default: 'related' })
  relationType!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;
}
