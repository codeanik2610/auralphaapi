import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { StrategyTemplateVersionChangeType } from '../../api/contracts/StrategyTemplate';

@Entity({ name: 'strategy_template_versions' })
@Index('idx_strategy_template_versions_template_created', ['strategyTemplateId', 'createdAt'])
@Index('idx_strategy_template_versions_template_version', ['strategyTemplateId', 'templateVersion'])
@Index('idx_strategy_template_versions_user_created', ['userId', 'createdAt'])
export class StrategyTemplateVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'strategy_template_id', type: 'uuid' })
  strategyTemplateId!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ name: 'actor_user_id', type: 'varchar', length: 191 })
  actorUserId!: string;

  @Column({ name: 'template_version', type: 'int' })
  templateVersion!: number;

  @Column({ name: 'change_type', type: 'varchar', length: 40 })
  changeType!: StrategyTemplateVersionChangeType;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 40 })
  status!: string;

  @Column({ type: 'jsonb', nullable: true })
  config!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
