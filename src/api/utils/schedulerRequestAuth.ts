import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { env } from '../../env';
import { Logger } from '../../lib/logger/Logger';
import { RedisClient } from '../../lib/RedisClient';
import { ServiceUnavailableAppError, UnauthorizedAppError } from '../errors/AppError';

const log = new Logger('SchedulerRequestAuth');
const SIGNATURE_VERSION = 'v1';
const HEADER_VERSION = 'x-scheduler-signature-version';
const HEADER_TIMESTAMP = 'x-scheduler-timestamp';
const HEADER_NONCE = 'x-scheduler-nonce';
const HEADER_SIGNATURE = 'x-scheduler-signature';
const REDIS_NONCE_KEY_PREFIX = 'scheduler:request-nonce';

function nonceRedisKey(nonceKey: string): string {
  return `${REDIS_NONCE_KEY_PREFIX}:${createHash('sha256').update(nonceKey).digest('hex')}`;
}

type HeaderLookup = {
  get(name: string): string | undefined;
};

type SignedSchedulerRequestInput = {
  method: string;
  path: string;
  body?: unknown;
  headers: HeaderLookup;
  logContext?: string;
  remoteAddress?: string | null;
};

type SignedSchedulerRequestHeaderInput = {
  method: string;
  url: string;
  body?: unknown;
  secret?: string;
  timestamp?: string;
  nonce?: string;
};

function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item));
  }

  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return Object.keys(objectValue)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        const normalized = normalizeJsonValue(objectValue[key]);
        if (normalized !== undefined) {
          accumulator[key] = normalized;
        }
        return accumulator;
      }, {});
  }

  return value;
}

function stableJsonStringify(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  return JSON.stringify(normalizeJsonValue(value));
}

function hashBody(body: unknown): string {
  return createHash('sha256').update(stableJsonStringify(body)).digest('hex');
}

function createSignature(params: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
  secret: string;
}): string {
  const signaturePayload = [
    SIGNATURE_VERSION,
    params.method.trim().toUpperCase(),
    params.path.trim(),
    params.timestamp.trim(),
    params.nonce.trim(),
    params.bodyHash.trim(),
  ].join('\n');

  return createHmac('sha256', params.secret).update(signaturePayload).digest('hex');
}

function compareSignatures(expected: string, received: string): boolean {
  try {
    const expectedBuffer = Buffer.from(expected, 'hex');
    const receivedBuffer = Buffer.from(received, 'hex');
    if (!expectedBuffer.length || expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }
    return timingSafeEqual(expectedBuffer, receivedBuffer);
  } catch {
    return false;
  }
}

function sanitizePath(path: string): string {
  const trimmed = String(path || '').trim();
  if (!trimmed) {
    return '/';
  }
  try {
    const parsed = new URL(trimmed);
    return `${parsed.pathname || '/'}${parsed.search || ''}`;
  } catch {
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }
}

function resolveSecret(secret?: string): string {
  return String(secret || env.scheduler.discovery.schedulerSecret || '').trim();
}

function readHeader(headers: HeaderLookup, name: string): string {
  return String(headers.get(name) || '').trim();
}

function maxClockSkewSeconds(): number {
  return env.scheduler.discovery.signatureMaxSkewSeconds;
}

function nonceTtlSeconds(): number {
  return env.scheduler.discovery.nonceTtlSeconds;
}

function logAuthFailure(message: string, context?: string, remoteAddress?: string | null): void {
  const suffixParts = [
    context ? `context=${context}` : null,
    remoteAddress ? `remote=${remoteAddress}` : null,
  ].filter(Boolean);
  log.warn(
    suffixParts.length ? `${message} (${suffixParts.join(', ')})` : message
  );
}

export function buildSignedSchedulerHeaders(
  input: SignedSchedulerRequestHeaderInput
): Record<string, string> {
  const secret = resolveSecret(input.secret);
  const timestamp = String(input.timestamp || Math.floor(Date.now() / 1000));
  const nonce = String(input.nonce || randomUUID());
  const path = sanitizePath(input.url);
  const bodyHash = hashBody(input.body);
  const signature = createSignature({
    method: input.method,
    path,
    timestamp,
    nonce,
    bodyHash,
    secret,
  });

  return {
    'X-Scheduler-Signature-Version': SIGNATURE_VERSION,
    'X-Scheduler-Timestamp': timestamp,
    'X-Scheduler-Nonce': nonce,
    'X-Scheduler-Signature': signature,
  };
}

export async function verifySignedSchedulerRequest(
  input: SignedSchedulerRequestInput
): Promise<void> {
  const secret = resolveSecret();
  const version = readHeader(input.headers, HEADER_VERSION);
  const timestamp = readHeader(input.headers, HEADER_TIMESTAMP);
  const nonce = readHeader(input.headers, HEADER_NONCE);
  const signature = readHeader(input.headers, HEADER_SIGNATURE);

  const hasSignedHeaders = Boolean(version || timestamp || nonce || signature);
  if (!hasSignedHeaders) {
    logAuthFailure('Scheduler request missing signed authentication headers', input.logContext, input.remoteAddress);
    throw new UnauthorizedAppError('Invalid scheduler request signature');
  }

  if (version !== SIGNATURE_VERSION) {
    logAuthFailure('Scheduler request used an unsupported signature version', input.logContext, input.remoteAddress);
    throw new UnauthorizedAppError('Invalid scheduler request signature');
  }

  const timestampValue = Number(timestamp);
  if (!Number.isInteger(timestampValue)) {
    logAuthFailure('Scheduler request timestamp is invalid', input.logContext, input.remoteAddress);
    throw new UnauthorizedAppError('Invalid scheduler request signature');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampValue) > maxClockSkewSeconds()) {
    logAuthFailure('Scheduler request timestamp is outside the allowed clock skew', input.logContext, input.remoteAddress);
    throw new UnauthorizedAppError('Invalid scheduler request signature');
  }

  if (!nonce || nonce.length < 12 || nonce.length > 200) {
    logAuthFailure('Scheduler request nonce is invalid', input.logContext, input.remoteAddress);
    throw new UnauthorizedAppError('Invalid scheduler request signature');
  }

  const nonceKey = `${version}:${timestamp}:${nonce}`;
  const ttlSeconds = nonceTtlSeconds();
  const redisKey = nonceRedisKey(nonceKey);
  let redisReplayAccepted = false;
  try {
    const redisResult = await RedisClient.getConnection().set(redisKey, '1', 'EX', ttlSeconds, 'NX');
    redisReplayAccepted = redisResult === 'OK';
  } catch (error) {
    log.error(
      `Redis replay protection unavailable${
        input.logContext ? ` (${input.logContext})` : ''
      }: ${error instanceof Error ? error.message : String(error)}`
    );
    throw new ServiceUnavailableAppError('Scheduler replay protection unavailable');
  }

  if (!redisReplayAccepted) {
    logAuthFailure('Scheduler request nonce was replayed', input.logContext, input.remoteAddress);
    throw new UnauthorizedAppError('Invalid scheduler request signature');
  }

  const expectedSignature = createSignature({
    method: input.method,
    path: sanitizePath(input.path),
    timestamp,
    nonce,
    bodyHash: hashBody(input.body),
    secret,
  });

  if (!compareSignatures(expectedSignature, signature)) {
    logAuthFailure('Scheduler request signature mismatch', input.logContext, input.remoteAddress);
    throw new UnauthorizedAppError('Invalid scheduler request signature');
  }
}

export async function verifySignedSchedulerRequestFromExpress(
  request: Request,
  body?: unknown,
  logContext?: string
): Promise<void> {
  await verifySignedSchedulerRequest({
    method: request.method,
    path: request.originalUrl || request.url,
    body,
    headers: {
      get: (name: string) => {
        const value = request.header(name);
        return value === undefined ? undefined : value;
      },
    },
    logContext,
    remoteAddress: request.ip || request.socket?.remoteAddress || null,
  });
}
