import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Automation } from './Automation';

@Entity({ name: 'automation_events' })
@Index('idx_automation_events_automation_created_at', ['automationId', 'createdAt'])
export class AutomationEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36 })
  automationId!: string;

  @Column({ type: 'varchar', length: 100 })
  type!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  entity!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  outcome!: string | null;

  @Column({ name: 'meta_json', type: 'simple-json', nullable: true })
  meta!: Record<string, unknown> | null;

  @ManyToOne(() => Automation, (automation) => automation.events, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'automationId' })
  automation!: Automation;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;
}
