import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Backtest } from './Backtest';

@Entity({ name: 'backtest_results' })
@Index('idx_backtest_results_user_backtest_id', ['userId', 'backtestId'])
@Index('idx_backtest_results_user_updated_at', ['userId', 'updatedAt'])
export class BacktestResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'backtest_id', type: 'uuid', unique: true })
  backtestId!: string;

  @Column({ type: 'double precision', nullable: true })
  cagr!: number | null;

  @Column({ type: 'double precision', nullable: true })
  sharpe!: number | null;

  @Column({ type: 'double precision', nullable: true })
  drawdown!: number | null;

  @Column({ name: 'win_rate', type: 'double precision', nullable: true })
  winRate!: number | null;

  @Column({ name: 'profit_factor', type: 'double precision', nullable: true })
  profitFactor!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  config!: Record<string, unknown> | null;

  // These values are derived from `config` and only exist in newer schemas.
  progressState!: string | null;

  progressProcessed!: number | null;

  progressTotal!: number | null;

  progressPercent!: number | null;

  resumeCheckpointState!: string | null;

  tradeEventCount!: number | null;

  performanceSurfaceResultCount!: number | null;

  @OneToOne(() => Backtest, (backtest) => backtest.result, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'backtest_id' })
  backtest!: Backtest;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
