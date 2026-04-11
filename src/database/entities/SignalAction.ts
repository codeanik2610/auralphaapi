import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Signal } from './Signal';

@Entity({ name: 'signal_actions' })
@Index('idx_signal_actions_signal_created_at', ['signalId', 'createdAt'])
export class SignalAction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36 })
  signalId!: string;

  @Column({ type: 'varchar', length: 30 })
  actionType!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  target!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  actor!: string | null;

  @Column({ type: 'json', nullable: true })
  metadata!: Record<string, unknown> | null;

  @ManyToOne(() => Signal, (signal) => signal.actions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'signalId' })
  signal!: Signal;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;
}
