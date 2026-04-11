import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'assets' })
@Unique('uq_assets_source_external_id', ['source', 'externalId'])
@Index('idx_assets_symbol_name', ['symbol', 'name'])
export class Asset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50 })
  source!: string;

  @Column({ type: 'varchar', length: 255 })
  externalId!: string;

  @Column({ type: 'varchar', length: 100 })
  symbol!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
