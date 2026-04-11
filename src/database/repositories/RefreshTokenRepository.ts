import { randomUUID } from 'crypto';
import { Service } from 'typedi';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { RefreshToken } from '../entities/RefreshToken';

export interface CreateRefreshTokenPayload {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | null;
  ipAddress?: string | null;
}

@Service()
export class RefreshTokenRepository {
  private get repository(): Repository<RefreshToken> {
    return coreDataSource.getRepository(RefreshToken);
  }

  async createToken(payload: CreateRefreshTokenPayload): Promise<RefreshToken> {
    const token = this.repository.create({
      id: randomUUID(),
      revokedAt: null,
      userId: payload.userId,
      tokenHash: payload.tokenHash,
      expiresAt: payload.expiresAt,
      userAgent: payload.userAgent || null,
      ipAddress: payload.ipAddress || null,
    });

    return this.repository.save(token);
  }

  async findActiveByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.repository.findOne({ where: { tokenHash, revokedAt: IsNull() } });
  }

  async listActiveByUserId(userId: string): Promise<RefreshToken[]> {
    return this.repository.find({
      where: {
        userId,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date())
      },
      order: {
        createdAt: 'DESC'
      }
    });
  }

  async revokeByHash(tokenHash: string): Promise<void> {
    await this.repository.update({ tokenHash, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  async revokeById(id: string): Promise<void> {
    await this.repository.update({ id, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  async revokeActiveByUserId(userId: string): Promise<number> {
    const result = await this.repository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() }
    );
    return result.affected || 0;
  }
}
