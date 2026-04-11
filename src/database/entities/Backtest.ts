import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BacktestResult } from './BacktestResult';

@Entity({ name: 'backtests' })
@Index('idx_backtests_status_created_at', ['status', 'createdAt'])
@Index('idx_backtests_symbol_created_at', ['symbol', 'createdAt'])
@Index('idx_backtests_user_created_at', ['userId', 'createdAt'])
@Index('idx_backtests_user_status_created_at', ['userId', 'status', 'createdAt'])
export class Backtest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  strategy!: string;

  @Column({ type: 'varchar', length: 50 })
  symbol!: string;

  @Column({ type: 'varchar', length: 255 })
  parameter!: string;

  @Column({ type: 'varchar', length: 30 })
  status!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  stability!: string | null;

  @Column({ type: 'int', default: 0 })
  trades!: number;

  @OneToOne(() => BacktestResult, (backtestResult) => backtestResult.backtest)
  result!: BacktestResult;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
