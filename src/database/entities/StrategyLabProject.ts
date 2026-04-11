import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'strategy_lab_projects' })
@Index('idx_strategy_lab_projects_user_updated_at', ['userId', 'updatedAt'])
export class StrategyLabProject {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36, name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'Draft' })
  status!: string;

  @Column({ name: 'project_version', type: 'int', default: 1 })
  projectVersion!: number;

  @Column({ name: 'source_template_id', type: 'varchar', length: 100, nullable: true })
  sourceTemplateId!: string | null;

  @Column({ name: 'source_template_version', type: 'int', nullable: true })
  sourceTemplateVersion!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  config!: Record<string, unknown> | null;

  @Column({ name: 'authoring_mode', type: 'varchar', length: 20, default: 'no_code' })
  authoringMode!: string;

  @Column({ name: 'code_target', type: 'varchar', length: 30, nullable: true })
  codeTarget!: string | null;

  @Column({ name: 'visual_definition', type: 'jsonb', nullable: true })
  visualDefinition!: Record<string, unknown> | null;

  @Column({ name: 'code_definition', type: 'text', nullable: true })
  codeDefinition!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  parameters!: Record<string, unknown> | null;

  @Column({ name: 'risk_config', type: 'jsonb', nullable: true })
  riskConfig!: Record<string, unknown> | null;

  @Column({ name: 'validation_state', type: 'varchar', length: 20, nullable: true, default: 'idle' })
  validationState!: string | null;

  @Column({ name: 'validation_errors', type: 'jsonb', nullable: true })
  validationErrors!: Array<Record<string, unknown>> | null;

  @Column({ name: 'validation_warnings', type: 'jsonb', nullable: true })
  validationWarnings!: Array<Record<string, unknown>> | null;

  @Column({ name: 'last_validated_at', type: 'timestamptz', nullable: true })
  lastValidatedAt!: Date | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  objective!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  market!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  timeframe!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  universe!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
