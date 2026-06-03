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
import { Backtest } from './Backtest';

@Entity({ name: 'backtest_trades' })
@Index('idx_backtest_trades_backtest_symbol_interval', ['backtestId', 'symbol', 'interval'])
@Index('idx_backtest_trades_user_entry_time', ['userId', 'entryTime'])
@Index('idx_backtest_trades_user_backtest_entry_time', ['userId', 'backtestId', 'entryTime'])
export class BacktestTrade {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'backtest_id', type: 'uuid' })
  backtestId!: string;

  @ManyToOne(() => Backtest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'backtest_id' })
  backtest?: Backtest;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ type: 'varchar', length: 64 })
  symbol!: string;

  @Column({ type: 'varchar', length: 8 })
  interval!: string;

  @Column({ type: 'varchar', length: 10 })
  side!: 'BUY' | 'SELL';

  @Column({ name: 'entry_time', type: 'timestamptz' })
  entryTime!: Date;

  @Column({ name: 'entry_price', type: 'numeric', precision: 30, scale: 12 })
  entryPrice!: string;

  @Column({ name: 'exit_time', type: 'timestamptz', nullable: true })
  exitTime!: Date | null;

  @Column({ name: 'exit_price', type: 'numeric', precision: 30, scale: 12, nullable: true })
  exitPrice!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
