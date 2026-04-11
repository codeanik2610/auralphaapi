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
import { PortfolioSnapshot } from './PortfolioSnapshot';

@Entity({ name: 'portfolio_holdings' })
@Index('idx_portfolio_holdings_snapshot_symbol', ['snapshotId', 'symbol'])
@Index('idx_portfolio_holdings_sleeve_updated_at', ['sleeve', 'updatedAt'])
@Index('idx_portfolio_holdings_snapshot_user_value', ['snapshotId', 'userId', 'marketValue'])
export class PortfolioHolding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36 })
  snapshotId!: string;

  @Column({ type: 'varchar', length: 50 })
  symbol!: string;

  @Column({ type: 'double', default: 0 })
  quantity!: number;

  @Column({ type: 'double', default: 0 })
  marketValue!: number;

  @Column({ type: 'double', default: 0 })
  allocationPct!: number;

  @Column({ type: 'double', default: 0 })
  dayPnL!: number;

  @Column({ type: 'double', default: 0 })
  unrealizedPnL!: number;

  @Column({ type: 'varchar', length: 20 })
  side!: string;

  @Column({ type: 'varchar', length: 255 })
  strategy!: string;

  @Column({ type: 'varchar', length: 50 })
  riskState!: string;

  @Column({ type: 'varchar', length: 50 })
  sleeve!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  contribution!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastRebalanceAt!: Date | null;

  @ManyToOne(() => PortfolioSnapshot, (snapshot) => snapshot.holdings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'snapshotId' })
  snapshot!: PortfolioSnapshot;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
