import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { env } from '../env';

const ENCRYPTION_PREFIX = 'enc:v1:';
export const DEFAULT_BROKER_ACCOUNT_SECRET_KEYS = ['apiKey', 'apiSecret'] as const;

export const normalizeBrokerAccountSettingKey = (key: string): string =>
  String(key || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export const createBrokerAccountSecretKeySet = (
  keys?: Iterable<string>
): Set<string> => {
  const normalizedKeys = new Set(
    DEFAULT_BROKER_ACCOUNT_SECRET_KEYS.map((key) =>
      normalizeBrokerAccountSettingKey(key)
    )
  );

  if (keys) {
    for (const key of keys) {
      const normalizedKey = normalizeBrokerAccountSettingKey(key);
      if (normalizedKey) {
        normalizedKeys.add(normalizedKey);
      }
    }
  }

  return normalizedKeys;
};

const deriveKey = (): Buffer =>
  createHash('sha256')
    .update(env.security.brokerAccountSecretsKey)
    .digest();

const isEncryptedValue = (value: string): boolean => value.startsWith(ENCRYPTION_PREFIX);

const encryptValue = (plainText: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
};

const decryptValue = (cipherText: string): string => {
  if (!isEncryptedValue(cipherText)) {
    return cipherText;
  }

  const payload = cipherText.slice(ENCRYPTION_PREFIX.length);
  const [ivBase64, authTagBase64, encryptedBase64] = payload.split(':');

  if (!ivBase64 || !authTagBase64 || !encryptedBase64) {
    return cipherText;
  }

  try {
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const encrypted = Buffer.from(encryptedBase64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(), iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return cipherText;
  }
};

export const encryptBrokerAccountSettings = (
  settings?: Record<string, unknown>,
  secretKeys?: Iterable<string>
): Record<string, unknown> | undefined => {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return settings;
  }

  const encryptedKeys = createBrokerAccountSecretKeySet(secretKeys);

  return Object.fromEntries(
    Object.entries(settings).map(([key, value]) => {
      const normalizedKey = normalizeBrokerAccountSettingKey(key);
      if (
        !encryptedKeys.has(normalizedKey) ||
        typeof value !== 'string' ||
        !value.trim()
      ) {
        return [key, value];
      }

      if (isEncryptedValue(value)) {
        return [key, value];
      }

      return [key, encryptValue(value.trim())];
    })
  );
};

export const decryptBrokerAccountSettings = (
  settings?: Record<string, unknown>
): Record<string, unknown> | undefined => {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return settings;
  }

  return Object.fromEntries(
    Object.entries(settings).map(([key, value]) => {
      if (typeof value !== 'string' || !value.trim()) {
        return [key, value];
      }

      return [key, decryptValue(value)];
    })
  );
};
