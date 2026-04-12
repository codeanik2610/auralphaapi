import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { BacktestPromotionRules } from '../../api/contracts/Settings';

@Entity({ name: 'settings_audit_logs' })
@Index('idx_settings_audit_logs_user_created_at', ['userId', 'createdAt'])
export class SettingsAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 50 })
  fieldName!: string;

  @Column({ type: 'text', nullable: true })
  oldValue!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  oldValueType!: string | null;

  @Column({ type: 'json', nullable: true })
  oldValueJson!: string | boolean | number | BacktestPromotionRules | null;

  @Column({ type: 'text', nullable: true })
  newValue!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  newValueType!: string | null;

  @Column({ type: 'json', nullable: true })
  newValueJson!: string | boolean | number | BacktestPromotionRules | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  changeType!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  actor!: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;
}
