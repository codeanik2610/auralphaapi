import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SuggestedTradeExecution } from './SuggestedTradeExecution';

@Entity({ name: 'suggested_trades' })
@Index('idx_suggested_trades_automation_signal_time', ['automationId', 'signalTime'])
@Index('idx_suggested_trades_user_status_signal_time', ['userId', 'status', 'signalTime'])
@Index('idx_suggested_trades_user_automation_status_signal_time', [
  'userId',
  'automationId',
  'status',
  'signalTime',
])
@Index('idx_suggested_trades_user_run_signal_time', ['userId', 'automationRunId', 'signalTime'])
@Index('idx_suggested_trades_symbol_timeframe_status', ['symbol', 'timeframe', 'status'])
@Index('uidx_suggested_trades_automation_dedupe_key', ['automationId', 'dedupeKey'], {
  unique: true,
})
export class SuggestedTrade {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'automation_id', type: 'char', length: 36 })
  automationId!: string;

  @Column({ name: 'automation_run_id', type: 'char', length: 36 })
  automationRunId!: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId!: string;

  @Column({ name: 'source_backtest_id', type: 'char', length: 36, nullable: true })
  sourceBacktestId!: string | null;

  @Column({ name: 'source_template_id', type: 'char', length: 36, nullable: true })
  sourceTemplateId!: string | null;

  @Column({ name: 'source_setup_key', type: 'varchar', length: 191, nullable: true })
  sourceSetupKey!: string | null;

  @Column({ type: 'varchar', length: 64 })
  symbol!: string;

  @Column({ type: 'varchar', length: 16 })
  timeframe!: string;

  @Column({ type: 'varchar', length: 10 })
  side!: string;

  @Column({ name: 'signal_time', type: 'timestamp' })
  signalTime!: Date;

  @Column({ type: 'varchar', length: 32, default: 'Open' })
  status!: string;

  @Column({ type: 'double', nullable: true })
  confidence!: number | null;

  @Column({ type: 'double', nullable: true })
  score!: number | null;

  @Column({ name: 'entry_price', type: 'decimal', precision: 30, scale: 12, nullable: true })
  entryPrice!: string | null;

  @Column({ name: 'stop_loss_price', type: 'decimal', precision: 30, scale: 12, nullable: true })
  stopLossPrice!: string | null;

  @Column({ name: 'take_profit_targets', type: 'json', nullable: true })
  takeProfitTargets!: Array<number | string> | null;

  @Column({ name: 'entry_rule', type: 'text', nullable: true })
  entryRule!: string | null;

  @Column({ name: 'exit_rule', type: 'text', nullable: true })
  exitRule!: string | null;

  @Column({ type: 'text', nullable: true })
  rationale!: string | null;

  @Column({ name: 'dedupe_key', type: 'varchar', length: 191 })
  dedupeKey!: string;

  @Column({ name: 'meta_json', type: 'json', nullable: true })
  meta!: Record<string, unknown> | null;

  @OneToOne(() => SuggestedTradeExecution, (executionRecord) => executionRecord.suggestedTrade)
  executionRecord?: SuggestedTradeExecution | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
