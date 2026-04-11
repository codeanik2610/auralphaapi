import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'strategy_templates' })
@Index('idx_strategy_templates_user_updated_at', ['userId', 'updatedAt'])
@Index('idx_strategy_templates_user_status', ['userId', 'status'])
@Index('uidx_strategy_templates_user_id_id', ['userId', 'id'], { unique: true })
export class StrategyTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 40, default: 'Draft' })
  status!: string;

  @Column({ name: 'template_version', type: 'int', default: 1 })
  templateVersion!: number;

  @Column({ type: 'jsonb', nullable: true })
  config!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
