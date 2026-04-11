import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * PostgreSQL migrations enforce same-user template ownership, trimmed/case-insensitive
 * duplicate-name protection, and jsonb shape checks for this table.
 */
@Entity({ name: 'strategy_library' })
@Index('idx_strategy_library_user_updated_at', ['userId', 'updatedAt'])
@Index('idx_strategy_library_user_status', ['userId', 'status'])
@Index('idx_strategy_library_user_template', ['userId', 'templateId'])
export class StrategyLibrary {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ name: 'template_id', type: 'uuid' })
  templateId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 40, default: 'Draft' })
  status!: string;

  @Column({ type: 'jsonb', nullable: true })
  assets!: Record<string, unknown>[] | null;

  @Column({ type: 'jsonb', nullable: true })
  timeframes!: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  overrides!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
