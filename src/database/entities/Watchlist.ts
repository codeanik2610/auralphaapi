import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WatchlistItem } from './WatchlistItem';

@Entity({ name: 'watchlists' })
@Index('idx_watchlists_type_updated_at', ['type', 'updatedAt'])
@Index('idx_watchlists_user_updated_at', ['userId', 'updatedAt'])
@Index('uidx_watchlists_id_user_id', ['id', 'userId'], { unique: true })
export class Watchlist {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;
  // Owner-scoped case-insensitive uniqueness is enforced in the migration via normalized_name.

  @Column({ type: 'varchar', length: 30 })
  type!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @OneToMany(() => WatchlistItem, (watchlistItem) => watchlistItem.watchlist)
  items!: WatchlistItem[];

  // Populated via relation-count loading for list/detail read models.
  itemsCount?: number;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
