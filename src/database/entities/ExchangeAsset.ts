import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

// Phase 4 schema cleanup, now carried forward as the Phase 5 steady-state contract:
// broker_assets is now a pure global broker or exchange asset catalog.
@Entity({ name: 'broker_assets' })
@Unique('uq_broker_assets_source_symbol', ['source', 'symbol'])
@Index('idx_broker_assets_source_symbol_name', ['source', 'symbol', 'name'])
@Index('idx_broker_assets_broker_id', ['brokerId'])
@Index('idx_broker_assets_source_external_id', ['source', 'externalId'])
@Index('idx_broker_assets_source_asset_id', ['source', 'assetId'])
export class ExchangeAsset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50 })
  source!: string;

  @Column({ name: 'broker_id', type: 'char', length: 36, nullable: true })
  brokerId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  externalId!: string;

  @Column({ type: 'varchar', length: 36 })
  assetId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 100 })
  symbol!: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
