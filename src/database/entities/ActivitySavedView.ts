import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'activity_saved_views' })
@Index('idx_activity_saved_views_user_created_at', ['userId', 'createdAt'])
@Index('idx_activity_saved_views_user_default_updated_at', ['userId', 'isDefault', 'updatedAt'])
export class ActivitySavedView {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ type: 'varchar', length: 16, default: 'feed' })
  view!: string;

  @Column({ name: 'group_by', type: 'varchar', length: 16, nullable: true })
  groupBy!: string | null;

  @Column({ name: 'sort_by', type: 'varchar', length: 16, default: 'time' })
  sortBy!: string;

  @Column({ name: 'sort_order', type: 'varchar', length: 8, default: 'desc' })
  sortOrder!: string;

  @Column({ name: 'read_state', type: 'varchar', length: 16, default: 'all' })
  readState!: string;

  @Column({ name: 'filters_json', type: 'json', nullable: true })
  filters!: Record<string, string> | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
