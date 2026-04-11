import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

type NotificationChannel = 'both' | 'in-app' | 'email' | 'disabled';
type NotificationSeverity = 'all' | 'medium' | 'high' | 'critical';
type EscalationRoute = 'risk-review' | 'on-call' | 'manual';

@Entity({ name: 'app_settings' })
@Index('uidx_app_settings_user_id', ['userId'], { unique: true })
export class AppSetting {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number;

  @Column({ type: 'char', length: 36, name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 64, default: 'UTC' })
  timezone!: string;

  @Column({ type: 'boolean', default: true })
  notifyEmail!: boolean;

  @Column({ type: 'boolean', default: true })
  notifyInApp!: boolean;

  @Column({ type: 'boolean', default: true })
  confirmDestructive!: boolean;

  @Column({ type: 'varchar', length: 16, default: 'both' })
  notificationChannel!: NotificationChannel;

  @Column({ type: 'varchar', length: 16, default: 'all' })
  notificationSeverity!: NotificationSeverity;

  @Column({ type: 'varchar', length: 24, default: 'risk-review' })
  escalationRoute!: EscalationRoute;

  @Column({ type: 'int', default: 15 })
  escalationSlaMinutes!: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
