import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'brokers' })
@Index('uidx_brokers_broker_key', ['brokerKey'], { unique: true })
@Index('uidx_brokers_name', ['name'], { unique: true })
export class Broker {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'broker_key', type: 'varchar', length: 100 })
  brokerKey!: string;

  @Column({ type: 'varchar', length: 191 })
  name!: string;

  @Column({ type: 'varchar', length: 32, default: 'broker' })
  category!: string;

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status!: string;

  @Column({ name: 'provider_type', type: 'varchar', length: 32, default: 'broker' })
  providerType!: string;

  @Column({ name: 'linked_exchange_key', type: 'varchar', length: 100, nullable: true })
  linkedExchangeKey!: string | null;

  @Column({ name: 'base_url', type: 'varchar', length: 255, nullable: true })
  baseUrl!: string | null;

  @Column({ type: 'json', nullable: true })
  capabilities!: string[] | null;

  @Column({ name: 'account_config', type: 'json', nullable: true })
  accountConfig!: Record<string, unknown> | null;

  @Column({ name: 'integration_guide', type: 'json', nullable: true })
  integrationGuide!: Record<string, unknown> | null;

  @Column({ name: 'diagnostics_config', type: 'json', nullable: true })
  diagnosticsConfig!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt!: Date;
}
