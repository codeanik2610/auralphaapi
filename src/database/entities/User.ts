import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 191, unique: true })
  email!: string;

  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 191, name: 'full_name' })
  fullName!: string;

  @Column({ type: 'varchar', length: 64, default: 'Trader' })
  role!: string;

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status!: string;

  @Column({ type: 'timestamp', nullable: true, name: 'last_login_at' })
  lastLoginAt!: Date | null;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt!: Date;
}
