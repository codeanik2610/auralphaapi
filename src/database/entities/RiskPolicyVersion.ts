import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'risk_policy_versions' })
@Index('idx_risk_policy_versions_policy_created', ['policyId', 'createdAt'])
@Index('idx_risk_policy_versions_user_created', ['userId', 'createdAt'])
export class RiskPolicyVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'policy_id', type: 'char', length: 36 })
  policyId!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 191 })
  userId!: string;

  @Column({ name: 'actor_user_id', type: 'varchar', length: 191 })
  actorUserId!: string;

  @Column({ name: 'version_payload', type: 'text' })
  versionPayload!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;
}

