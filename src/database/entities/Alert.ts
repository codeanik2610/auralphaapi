import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AlertAction } from './AlertAction';

@Entity({ name: 'alerts' })
@Index('idx_alerts_user_created_at', ['userId', 'createdAt'])
@Index('idx_alerts_user_status_created_at', ['userId', 'status', 'createdAt'])
@Index('idx_alerts_user_severity_created_at', ['userId', 'severity', 'createdAt'])
@Index('idx_alerts_status_created_at', ['status', 'createdAt'])
@Index('idx_alerts_severity_created_at', ['severity', 'createdAt'])
export class Alert {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 20 })
  severity!: string;

  @Column({ type: 'varchar', length: 50 })
  channel!: string;

  @Column({ type: 'varchar', length: 50 })
  symbol!: string;

  @Column({ type: 'varchar', length: 255 })
  message!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  route!: string | null;

  @Column({ type: 'varchar', length: 20 })
  status!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  source!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  urgency!: string | null;

  @OneToMany(() => AlertAction, (alertAction) => alertAction.alert)
  actions!: AlertAction[];

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
