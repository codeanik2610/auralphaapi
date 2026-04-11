import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'activity_exports' })
@Index('idx_activity_exports_user_created_at', ['userId', 'createdAt'])
@Index('idx_activity_exports_user_status_created_at', ['userId', 'status', 'createdAt'])
@Index('idx_activity_exports_status_created_at', ['status', 'createdAt'])
@Index('idx_activity_exports_expires_at', ['expiresAt'])
@Index('idx_activity_exports_user_status_signature', ['userId', 'status', 'filterSignature', 'expiresAt'])
export class ActivityExport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ type: 'varchar', length: 32 })
  scope!: string;

  @Column({ type: 'varchar', length: 16 })
  format!: string;

  @Column({ type: 'varchar', length: 16, default: 'Ready' })
  status!: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName!: string;

  @Column({ name: 'content_type', type: 'varchar', length: 100 })
  contentType!: string;

  @Column({ name: 'exported_count', type: 'int', unsigned: true, default: 0 })
  exportedCount!: number;

  @Column({ name: 'filters_json', type: 'json', nullable: true })
  filters!: Record<string, string> | null;

  @Column({ name: 'filter_signature', type: 'varchar', length: 64, nullable: true })
  filterSignature!: string | null;

  @Column({ name: 'storage_path', type: 'varchar', length: 512, nullable: true })
  storagePath!: string | null;

  @Column({ type: 'longtext', nullable: true })
  content!: string | null;

  @Column({ name: 'error_message', type: 'varchar', length: 255, nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
