import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Automation } from './Automation';

@Entity({ name: 'automation_alerts' })
@Index('idx_automation_alerts_automation_created_at', ['automationId', 'createdAt'])
export class AutomationAlert {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36 })
  automationId!: string;

  @Column({ type: 'varchar', length: 255 })
  message!: string;

  @Column({ type: 'varchar', length: 20 })
  severity!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: string;

  @Column({ name: 'meta_json', type: 'simple-json', nullable: true })
  meta!: Record<string, unknown> | null;

  @ManyToOne(() => Automation, (automation) => automation.alerts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'automationId' })
  automation!: Automation;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
