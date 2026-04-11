import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

// Phase 2 schema foundation for asset-price-sync.
// Steady-state storage for asset-price-sync.
// asset_price is keyed by broker_asset_id so provider data stays anchored to broker_assets.id.
@Entity({ name: 'asset_price' })
@Index('idx_asset_price_source_symbol', ['source', 'symbol'])
@Index('idx_asset_price_symbol', ['symbol'])
@Index('idx_asset_price_retrieved_at', ['retrievedAt'])
@Index('idx_asset_price_updated_at', ['updatedAt'])
export class AssetPrice {
  @PrimaryColumn({ name: 'broker_asset_id', type: 'char', length: 36 })
  brokerAssetId!: string;

  @Column({ type: 'varchar', length: 100 })
  symbol!: string;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'source_symbol' })
  sourceSymbol!: string | null;

  @Column({ type: 'decimal', precision: 30, scale: 12 })
  price!: string;

  @Column({ type: 'varchar', length: 30 })
  source!: string;

  @Column({ type: 'datetime', name: 'retrieved_at' })
  retrievedAt!: Date;

  @Column({ type: 'datetime', name: 'updated_at' })
  updatedAt!: Date;
}
