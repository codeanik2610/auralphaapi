import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PortfolioHolding } from './PortfolioHolding';

@Entity({ name: 'portfolio_snapshots' })
@Index('idx_portfolio_snapshots_created_at', ['createdAt'])
@Index('idx_portfolio_snapshots_user_created_at', ['userId', 'createdAt'])
export class PortfolioSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'double', default: 0 })
  equity!: number;

  @Column({ type: 'double', default: 0 })
  dayPnL!: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  netExposure!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  diversification!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  assetAllocation!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  strategyMix!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  riskPosture!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  accountCurve!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  monthlyPace!: string | null;

  @OneToMany(() => PortfolioHolding, (holding) => holding.snapshot)
  holdings!: PortfolioHolding[];

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
