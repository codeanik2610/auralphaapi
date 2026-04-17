import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'risk_snapshots' })
@Index('idx_risk_snapshots_created_at', ['createdAt'])
export class RiskSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  portfolioRisk!: string | null;

  @Column({ type: 'int', unsigned: true, default: 0 })
  breachedRules!: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  liquidationWatch!: number;

  @Column({ type: 'double', default: 0 })
  capitalAtRisk!: number;

  @Column({ name: 'denominator_basis', type: 'varchar', length: 50, nullable: true })
  denominatorBasis!: string | null;

  @Column({ name: 'portfolio_equity', type: 'double', default: 0 })
  portfolioEquity!: number;

  @Column({ name: 'gross_exposure', type: 'double', default: 0 })
  grossExposure!: number;

  @Column({ name: 'net_exposure', type: 'double', default: 0 })
  netExposure!: number;

  @Column({ name: 'long_exposure', type: 'double', default: 0 })
  longExposure!: number;

  @Column({ name: 'short_exposure', type: 'double', default: 0 })
  shortExposure!: number;

  @Column({ name: 'open_orders', type: 'int', unsigned: true, default: 0 })
  openOrders!: number;

  @Column({ name: 'open_order_exposure', type: 'double', default: 0 })
  openOrderExposure!: number;

  @Column({ name: 'reserved_order_margin', type: 'double', default: 0 })
  reservedOrderMargin!: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  marginUsage!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  drawdownBudgetUsed!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  weeklyDrawdownBudgetUsed!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  monthlyDrawdownBudgetUsed!: string | null;

  @Column({ type: 'int', unsigned: true, default: 0 })
  atRiskPositions!: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  ruleViolations!: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  portfolioRiskScore!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  primaryConcern!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  riskByPosition!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  riskByStrategy!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  riskByGuardrail!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  guardrailOne!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  guardrailTwo!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  guardrailThree!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  actionOne!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  actionTwo!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  actionThree!: string | null;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ name: 'funds_observed_at', type: 'timestamp', nullable: true })
  fundsObservedAt!: Date | null;

  @Column({ name: 'positions_observed_at', type: 'timestamp', nullable: true })
  positionsObservedAt!: Date | null;

  @Column({ name: 'orders_observed_at', type: 'timestamp', nullable: true })
  ordersObservedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
