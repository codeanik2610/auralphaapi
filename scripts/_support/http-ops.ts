import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '../../src/env';

export type JsonRecord = Record<string, unknown>;

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;

export const BASE_URL =
  process.env.HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
export const API_KEY = String(process.env.APP_API_KEY || process.env.API_KEY || '').trim();
export const LOGIN_EMAIL =
  process.env.SMOKE_LOGIN_EMAIL || process.env.AUTH_SEED_EMAIL || 'admin@auralpha.com';
export const LOGIN_PASSWORD =
  process.env.SMOKE_LOGIN_PASSWORD || process.env.AUTH_SEED_PASSWORD || 'Admin@123';
export const STEP_SUMMARY_FILE = String(process.env.GITHUB_STEP_SUMMARY || '').trim();

export function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

export function asArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is JsonRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  );
}

export function readString(value: unknown): string {
  return String(value || '').trim();
}

export function readNumber(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function readNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return readNumber(value);
}

export async function requestJson(
  routePath: string,
  init: RequestInit = {},
  accessToken = ''
): Promise<JsonRecord> {
  const headers = new Headers(init.headers || {});
  if (accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  } else if (API_KEY) {
    headers.set('x-api-key', API_KEY);
  }

  const response = await fetch(`${BASE_URL}${routePath}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  let payload: JsonRecord = {};
  try {
    payload = text ? (JSON.parse(text) as JsonRecord) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      `${init.method || 'GET'} ${routePath} -> HTTP ${response.status}: ${JSON.stringify(payload)}`
    );
  }

  return payload;
}

export async function login(): Promise<string> {
  assert.ok(LOGIN_EMAIL, 'SMOKE_LOGIN_EMAIL or AUTH_SEED_EMAIL is required');
  assert.ok(LOGIN_PASSWORD, 'SMOKE_LOGIN_PASSWORD or AUTH_SEED_PASSWORD is required');

  const response = await requestJson('/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: LOGIN_EMAIL,
      password: LOGIN_PASSWORD,
    }),
  });
  const accessToken = readString(asRecord(response.data).accessToken);
  assert.ok(accessToken, 'login should return an access token');
  return accessToken;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function runNpmScript(scriptName: string, extraEnv: Record<string, string> = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', ['run', scriptName], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`npm run ${scriptName} terminated by signal ${signal}`));
        return;
      }
      if (code && code !== 0) {
        reject(new Error(`npm run ${scriptName} exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

export async function persistJson(outputFile: string, payload: Record<string, unknown>): Promise<void> {
  if (!outputFile) {
    return;
  }

  const absoluteOutputPath = path.resolve(process.cwd(), outputFile);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function writeStepSummary(lines: string[]): Promise<void> {
  if (!STEP_SUMMARY_FILE) {
    return;
  }

  await writeFile(STEP_SUMMARY_FILE, `${lines.join('\n')}\n`, 'utf8');
}
