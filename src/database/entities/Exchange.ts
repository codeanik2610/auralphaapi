import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'exchanges' })
@Index('uidx_exchanges_exchange_key', ['exchangeKey'], { unique: true })
export class Exchange {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'exchange_key', type: 'varchar', length: 100 })
  exchangeKey!: string;

  @Column({ type: 'varchar', length: 191 })
  name!: string;

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status!: string;

  @Column({ name: 'base_url', type: 'varchar', length: 255, nullable: true })
  baseUrl!: string | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt!: Date;
}
