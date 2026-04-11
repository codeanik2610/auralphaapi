import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'market_symbol_snapshots' })
@Index('idx_market_symbol_snapshots_snapshot_at', ['snapshotAt'])
@Index('idx_market_symbol_snapshots_liquidity_updated_at', ['liquidityTier', 'updatedAt'])
@Index('idx_market_symbol_snapshots_volume_24h', ['volume24h'])
@Index('idx_market_symbol_snapshots_change_24h', ['change24h'])
@Index('idx_market_symbol_snapshots_last_price', ['lastPrice'])
@Index('idx_market_symbol_snapshots_liquidity_volume_24h', ['liquidityTier', 'volume24h'])
export class MarketSymbolSnapshot {
  @PrimaryColumn({ type: 'varchar', length: 50 })
  symbol!: string;

  @Column({ name: 'asset_id', type: 'varchar', length: 36, nullable: true })
  assetId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  source!: string | null;

  @Column({ name: 'last_price', type: 'decimal', precision: 30, scale: 12, nullable: true })
  lastPrice!: string | null;

  @Column({ name: 'change_24h', type: 'double', nullable: true })
  change24h!: number | null;

  @Column({ name: 'volume_24h', type: 'double', nullable: true })
  volume24h!: number | null;

  @Column({ name: 'high_24h', type: 'decimal', precision: 30, scale: 12, nullable: true })
  high24h!: string | null;

  @Column({ name: 'low_24h', type: 'decimal', precision: 30, scale: 12, nullable: true })
  low24h!: string | null;

  @Column({ name: 'liquidity_tier', type: 'varchar', length: 20, nullable: true })
  liquidityTier!: string | null;

  @Column({ name: 'price_source', type: 'varchar', length: 50, nullable: true })
  priceSource!: string | null;

  @Column({ name: 'snapshot_at', type: 'datetime', nullable: true })
  snapshotAt!: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
