import { Service } from 'typedi';
import { env } from '../../env';
import { RateLimitAppError } from '../errors/AppError';

type AttemptBucket = {
  count: number;
  windowStartedAt: number;
  lockedUntil: number;
  updatedAt: number;
};

type LoginAttemptContext = {
  email?: string;
  ipAddress?: string;
};

export type AuthLoginProtectionSnapshot = {
  trackedBuckets: number;
  activePairLockouts: number;
  activeIpLockouts: number;
  pairFailuresInWindow: number;
  ipFailuresInWindow: number;
  nextLockoutExpiresAt: string | null;
};

const MINUTE_MS = 60_000;

@Service()
export class AuthLoginProtectionService {
  private readonly buckets = new Map<string, AttemptBucket>();

  private operationsSinceCleanup = 0;

  private normalizeEmail(email?: string): string {
    return String(email || '').trim().toLowerCase();
  }

  private normalizeIpAddress(ipAddress?: string): string {
    return String(ipAddress || '').trim() || 'unknown';
  }

  private getPairKey(context: LoginAttemptContext): string {
    return `login:pair:${this.normalizeIpAddress(context.ipAddress)}:${this.normalizeEmail(context.email) || 'unknown'}`;
  }

  private getIpKey(context: LoginAttemptContext): string {
    return `login:ip:${this.normalizeIpAddress(context.ipAddress)}`;
  }

  private getWindowMs(): number {
    return env.auth.loginWindowMinutes * MINUTE_MS;
  }

  private getLockoutMs(): number {
    return env.auth.loginLockoutMinutes * MINUTE_MS;
  }

  private getRetentionMs(): number {
    return Math.max(this.getWindowMs(), this.getLockoutMs());
  }

  private removeExpiredBuckets(now: number): void {
    const retentionMs = this.getRetentionMs();

    for (const [key, bucket] of this.buckets.entries()) {
      const expiredWindow = bucket.windowStartedAt + retentionMs <= now;
      const expiredLock = bucket.lockedUntil <= now;

      if (expiredWindow && expiredLock) {
        this.buckets.delete(key);
      }
    }
  }

  private cleanupStaleBuckets(now: number): void {
    this.operationsSinceCleanup += 1;
    if (this.operationsSinceCleanup < 100) {
      return;
    }

    this.operationsSinceCleanup = 0;
    this.removeExpiredBuckets(now);
  }

  private assertKeyAllowed(key: string, now: number): void {
    const bucket = this.buckets.get(key);
    if (!bucket) {
      return;
    }

    if (bucket.lockedUntil > now) {
      const retryAfterMinutes = Math.max(
        1,
        Math.ceil((bucket.lockedUntil - now) / MINUTE_MS)
      );
      throw new RateLimitAppError(
        `Too many login attempts. Try again in about ${retryAfterMinutes} minute${retryAfterMinutes === 1 ? '' : 's'}.`
      );
    }

    if (bucket.windowStartedAt + this.getRetentionMs() <= now) {
      this.buckets.delete(key);
    }
  }

  private recordFailureForKey(key: string, limit: number, now: number): void {
    const existing = this.buckets.get(key);
    const windowMs = this.getWindowMs();

    if (!existing || existing.windowStartedAt + windowMs <= now) {
      this.buckets.set(key, {
        count: 1,
        windowStartedAt: now,
        lockedUntil: 0,
        updatedAt: now
      });
      return;
    }

    const nextCount = existing.count + 1;
    this.buckets.set(key, {
      ...existing,
      count: nextCount,
      lockedUntil:
        nextCount >= limit ? now + this.getLockoutMs() : existing.lockedUntil,
      updatedAt: now
    });
  }

  assertLoginAllowed(context: LoginAttemptContext): void {
    if (!env.auth.loginProtectionEnabled) {
      return;
    }

    const now = Date.now();
    this.cleanupStaleBuckets(now);
    this.assertKeyAllowed(this.getPairKey(context), now);
    this.assertKeyAllowed(this.getIpKey(context), now);
  }

  recordLoginFailure(context: LoginAttemptContext): void {
    if (!env.auth.loginProtectionEnabled) {
      return;
    }

    const now = Date.now();
    this.cleanupStaleBuckets(now);
    this.recordFailureForKey(this.getPairKey(context), env.auth.loginMaxAttempts, now);
    this.recordFailureForKey(this.getIpKey(context), env.auth.loginIpMaxAttempts, now);
  }

  recordLoginSuccess(context: LoginAttemptContext): void {
    if (!env.auth.loginProtectionEnabled) {
      return;
    }

    this.buckets.delete(this.getPairKey(context));
    this.buckets.delete(this.getIpKey(context));
  }

  getSnapshot(now = Date.now()): AuthLoginProtectionSnapshot {
    this.removeExpiredBuckets(now);

    let activePairLockouts = 0;
    let activeIpLockouts = 0;
    let pairFailuresInWindow = 0;
    let ipFailuresInWindow = 0;
    let nextLockoutExpiryMs = 0;

    for (const [key, bucket] of this.buckets.entries()) {
      const windowActive = bucket.windowStartedAt + this.getWindowMs() > now;
      const lockActive = bucket.lockedUntil > now;
      const isPairBucket = key.startsWith('login:pair:');
      const isIpBucket = key.startsWith('login:ip:');

      if (windowActive) {
        if (isPairBucket) {
          pairFailuresInWindow += bucket.count;
        }
        if (isIpBucket) {
          ipFailuresInWindow += bucket.count;
        }
      }

      if (lockActive) {
        if (isPairBucket) {
          activePairLockouts += 1;
        }
        if (isIpBucket) {
          activeIpLockouts += 1;
        }

        if (!nextLockoutExpiryMs || bucket.lockedUntil < nextLockoutExpiryMs) {
          nextLockoutExpiryMs = bucket.lockedUntil;
        }
      }
    }

    return {
      trackedBuckets: this.buckets.size,
      activePairLockouts,
      activeIpLockouts,
      pairFailuresInWindow,
      ipFailuresInWindow,
      nextLockoutExpiresAt: nextLockoutExpiryMs
        ? new Date(nextLockoutExpiryMs).toISOString()
        : null
    };
  }
}
