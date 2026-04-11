import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'trades' })
@Unique('uq_trades_dedup', [
  'strategy',
  'symbol',
  'interval',
  'side',
  'alertOpenTime',
  'confirmOpenTime',
])
@Index('idx_trades_symbol_interval', ['symbol', 'interval'])
export class Trade {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  strategy!: string;

  @Column({ type: 'varchar', length: 50 })
  symbol!: string;

  @Column({ type: 'varchar', length: 20 })
  interval!: string;

  @Column({ type: 'varchar', length: 10 })
  side!: 'BUY' | 'SELL';

  @Column({ type: 'bigint' })
  alertOpenTime!: number;

  @Column({ type: 'bigint' })
  confirmOpenTime!: number;

  @Column({ type: 'varchar', length: 50 })
  alertHigh!: string;

  @Column({ type: 'varchar', length: 50 })
  alertLow!: string;

  @Column({ type: 'varchar', length: 50 })
  confirmClose!: string;

  @Column({ type: 'int', unsigned: true })
  barsWaited!: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
