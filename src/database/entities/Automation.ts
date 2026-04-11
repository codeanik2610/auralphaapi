import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AutomationAlert } from './AutomationAlert';
import { AutomationEvent } from './AutomationEvent';

@Entity({ name: 'automations' })
@Index('idx_automations_user_status_updated_at', ['userId', 'status', 'updatedAt'])
@Index('idx_automations_user_market_updated_at', ['userId', 'market', 'updatedAt'])
@Index('idx_automations_user_scope_lookup', ['userId', 'automationType', 'sourceBacktestId', 'scopeSymbol', 'scopeTimeframe'])
@Index('idx_automations_user_source_template_updated_at', ['userId', 'sourceTemplateId', 'updatedAt'])
export class Automation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  strategy!: string;

  @Column({ type: 'varchar', length: 255 })
  broker!: string;

  @Column({ type: 'varchar', length: 50 })
  market!: string;

  @Column({ type: 'varchar', length: 255 })
  trigger!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  automationType!: string | null;

  @Column({ type: 'varchar', length: 30 })
  status!: string;

  @Column({ type: 'timestamp', nullable: true })
  lastRun!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  nextRun!: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  timeZone!: string | null;

  @Column({ type: 'int', unsigned: true, default: 0 })
  accounts!: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  riskMode!: string | null;

  @Column({ type: 'json', nullable: true })
  schedule!: Record<string, unknown> | null;

  @Column({ type: 'json', nullable: true })
  config!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  searchText!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  sourceBacktestId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  scopeSymbol!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  scopeTimeframe!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  sourceTemplateId!: string | null;

  @OneToMany(() => AutomationEvent, (event) => event.automation)
  events!: AutomationEvent[];

  @OneToMany(() => AutomationAlert, (alert) => alert.automation)
  alerts!: AutomationAlert[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
