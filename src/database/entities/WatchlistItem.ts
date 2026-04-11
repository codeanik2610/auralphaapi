import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Watchlist } from './Watchlist';

@Entity({ name: 'watchlist_items' })
@Index('idx_watchlist_items_watchlist_symbol', ['watchlistId', 'symbol'])
@Index('idx_watchlist_items_status_updated_at', ['status', 'updatedAt'])
@Index('idx_watchlist_items_user_watchlist_updated_at', ['userId', 'watchlistId', 'updatedAt'])
@Index('uidx_watchlist_items_owner_watchlist_symbol', ['userId', 'watchlistId', 'symbol'], {
  unique: true,
})
export class WatchlistItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36 })
  watchlistId!: string;

  @Column({ type: 'varchar', length: 50 })
  symbol!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  regime!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  signal!: string | null;

  @Column({ type: 'int', unsigned: true, nullable: true })
  aiScore!: number | null;

  @Column({ type: 'double', nullable: true })
  change24h!: number | null;

  @Column({ type: 'double', nullable: true })
  volume24h!: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  setup!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  status!: string | null;

  @Column({ type: 'int', unsigned: true, default: 0 })
  alerts!: number;

  @Column({ type: 'varchar', length: 30, nullable: true })
  liquidity!: string | null;

  @ManyToOne(() => Watchlist, (watchlist) => watchlist.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'watchlistId' })
  watchlist!: Watchlist;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
