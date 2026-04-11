import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SignalAction } from './SignalAction';

@Entity({ name: 'signals' })
@Index('idx_signals_status_created_at', ['status', 'createdAt'])
@Index('idx_signals_symbol_created_at', ['symbol', 'createdAt'])
@Index('idx_signals_source_ref_signal_time', ['sourceRefType', 'sourceRefId', 'signalTime'])
@Index('idx_signals_user_status_signal_time', ['userId', 'status', 'signalTime'])
@Index('idx_signals_user_symbol_created_at', ['userId', 'symbol', 'createdAt'])
@Index('ux_signals_dedupe_key', ['dedupeKey'], { unique: true })
export class Signal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191, nullable: true })
  userId!: string | null;

  @Column({ type: 'varchar', length: 191 })
  dedupeKey!: string;

  @Column({ type: 'varchar', length: 50 })
  symbol!: string;

  @Column({ type: 'varchar', length: 100 })
  source!: string;

  @Column({ type: 'double' })
  confidence!: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  direction!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  timeframe!: string | null;

  @Column({ type: 'varchar', length: 30 })
  status!: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  market!: string | null;

  @Column({ type: 'datetime', nullable: true })
  signalTime!: Date | null;

  @Column({ type: 'decimal', precision: 30, scale: 12, nullable: true })
  entryPrice!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  sourceRefType!: string | null;

  @Column({ type: 'varchar', length: 191, nullable: true })
  sourceRefId!: string | null;

  @Column({ type: 'datetime', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  regime!: string | null;

  @Column({ type: 'int', unsigned: true, nullable: true })
  aiScore!: number | null;

  @Column({ type: 'text', nullable: true })
  thesis!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  route!: string | null;

  @Column({ type: 'text', nullable: true })
  riskNote!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  promotionState!: string | null;

  @Column({ type: 'json', nullable: true })
  metadata!: Record<string, unknown> | null;

  @OneToMany(() => SignalAction, (signalAction) => signalAction.signal)
  actions!: SignalAction[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
