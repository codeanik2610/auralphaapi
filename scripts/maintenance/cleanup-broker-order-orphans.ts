import 'reflect-metadata';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Container } from 'typedi';
import { BrokerRuntimeRegistry } from '../../src/brokers/core/BrokerRuntimeRegistry';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';
import {
  loadBrokerOrderOrphans,
  OrphanKind,
  OrphanOrderItem,
} from '../diagnostics/broker-order-orphans-lib';

type JsonRecord = Record<string, unknown>;

type CleanupOptions = {
  execute: boolean;
  kinds: Set<OrphanKind>;
  brokerKeys: Set<string>;
  accountIds: Set<string>;
  symbols: Set<string>;
  orderIds: Set<string>;
  limit: number;
  outputFile: string;
};

type LivePositionCheck = 'not_run' | 'passed_no_position' | 'found_position' | 'failed';

type CleanupResult = {
  brokerKey: string;
  accountId: string;
  accountName: string | null;
  userId: string;
  symbol: string;
  externalId: string;
  kind: OrphanKind;
  orderStatus: string | null;
  mode: 'dry_run' | 'execute';
  status:
    | 'would_cancel'
    | 'cancelled'
    | 'already_terminal'
    | 'skipped_live_position_found'
    | 'skipped_live_position_check_failed'
    | 'failed';
  livePositionCheck: LivePositionCheck;
  message: string;
  response?: unknown;
  error?: string;
};

const VALID_KINDS = new Set<OrphanKind>(['orphan_entry', 'orphan_protection', 'orphan_other']);
const DEFAULT_OUTPUT_FILE = 'artifacts/broker-order-orphans-cleanup.json';

function readString(value: unknown): string {
  return String(value || '').trim();
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function parseCsv(value: string | undefined): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionValue(args: string[], names: string[]): string | undefined {
  for (const arg of args) {
    for (const name of names) {
      if (arg.startsWith(`${name}=`)) {
        return arg.slice(name.length + 1);
      }
    }
  }
  return undefined;
}

function parseKinds(raw: string | undefined): Set<OrphanKind> {
  const values = parseCsv(raw);
  const kinds = values.length ? values : ['orphan_protection'];
  const normalized = new Set<OrphanKind>();

  for (const kind of kinds) {
    const candidate = kind.toLowerCase() as OrphanKind;
    if (!VALID_KINDS.has(candidate)) {
      throw new Error(`Unsupported orphan kind: ${kind}`);
    }
    normalized.add(candidate);
  }

  return normalized;
}

function parseSet(raw: string | undefined, normalize = true): Set<string> {
  return new Set(parseCsv(raw).map((item) => (normalize ? item.toLowerCase() : item)));
}

function parseOptions(args = process.argv.slice(2)): CleanupOptions {
  const execute =
    args.includes('--execute') ||
    readString(process.env.BROKER_ORDER_ORPHAN_CLEANUP_EXECUTE).toLowerCase() === 'true';
  const limitRaw = optionValue(args, ['--limit']) || process.env.BROKER_ORDER_ORPHAN_CLEANUP_LIMIT;
  const limit = Math.max(1, Math.floor(Number(limitRaw || 100)));

  return {
    execute,
    kinds: parseKinds(
      optionValue(args, ['--kind', '--kinds']) || process.env.BROKER_ORDER_ORPHAN_CLEANUP_KINDS
    ),
    brokerKeys: parseSet(
      optionValue(args, ['--broker', '--broker-key', '--brokerKeys']) ||
        process.env.BROKER_ORDER_ORPHAN_CLEANUP_BROKERS
    ),
    accountIds: parseSet(
      optionValue(args, ['--account-id', '--accountId', '--account']) ||
        process.env.BROKER_ORDER_ORPHAN_CLEANUP_ACCOUNT_IDS,
      false
    ),
    symbols: parseSet(
      optionValue(args, ['--symbol', '--symbols']) ||
        process.env.BROKER_ORDER_ORPHAN_CLEANUP_SYMBOLS
    ),
    orderIds: parseSet(
      optionValue(args, ['--order-id', '--orderId', '--external-id', '--externalId']) ||
        process.env.BROKER_ORDER_ORPHAN_CLEANUP_ORDER_IDS,
      false
    ),
    limit,
    outputFile:
      readString(
        optionValue(args, ['--output', '--output-file', '--outputFile']) ||
          process.env.BROKER_ORDER_ORPHAN_CLEANUP_OUTPUT_FILE
      ) || DEFAULT_OUTPUT_FILE,
  };
}

function matchesSet(
  value: string | null | undefined,
  values: Set<string>,
  normalize = true
): boolean {
  if (values.size === 0) {
    return true;
  }
  const candidate = readString(value);
  const normalized = normalize ? candidate.toLowerCase() : candidate;
  return values.has(normalized);
}

function filterItems(items: OrphanOrderItem[], options: CleanupOptions): OrphanOrderItem[] {
  return items
    .filter((item) => options.kinds.has(item.kind))
    .filter((item) => matchesSet(item.brokerKey, options.brokerKeys))
    .filter((item) => matchesSet(item.accountId, options.accountIds, false))
    .filter((item) => matchesSet(item.symbol, options.symbols))
    .filter((item) => matchesSet(item.externalId, options.orderIds, false))
    .slice(0, options.limit);
}

function extractArrayPayload(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.map(asRecord);
  }

  const root = asRecord(value);
  const data = root.data;
  if (Array.isArray(data)) {
    return data.map(asRecord);
  }

  const dataRecord = asRecord(data);
  for (const key of ['items', 'positions', 'result', 'rows']) {
    const nested = dataRecord[key];
    if (Array.isArray(nested)) {
      return nested.map(asRecord);
    }
  }

  return [];
}

function readPositionSymbol(position: JsonRecord): string | null {
  for (const key of ['symbol', 'product_symbol', 'asset_symbol', 'pair', 'instrument']) {
    const value = readString(position[key]);
    if (value) {
      return value.toLowerCase();
    }
  }
  return null;
}

function livePositionCacheKey(item: OrphanOrderItem): string {
  return `${item.brokerKey}:${item.accountId}:${item.userId}`;
}

async function fetchLivePositionSymbols(
  registry: BrokerRuntimeRegistry,
  item: OrphanOrderItem
): Promise<Set<string>> {
  const adapter = registry.getPositionsAdapter(item.brokerKey);
  const response = await adapter.getPositions(
    { limit: 500 },
    {
      userId: item.userId,
      brokerKey: item.brokerKey,
      accountId: item.accountId,
    }
  );
  return new Set(
    extractArrayPayload(response)
      .map(readPositionSymbol)
      .filter((symbol): symbol is string => Boolean(symbol))
  );
}

function isIdempotentCancelError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('terminal state') ||
    message.includes('already') ||
    message.includes('not found') ||
    message.includes('does not exist') ||
    message.includes('cancelled') ||
    message.includes('canceled') ||
    message.includes('closed')
  );
}

function jsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

function buildDryRunResult(item: OrphanOrderItem): CleanupResult {
  return {
    brokerKey: item.brokerKey,
    accountId: item.accountId,
    accountName: item.accountName,
    userId: item.userId,
    symbol: item.symbol,
    externalId: item.externalId,
    kind: item.kind,
    orderStatus: item.orderStatus,
    mode: 'dry_run',
    status: 'would_cancel',
    livePositionCheck: 'not_run',
    message: 'Dry-run only. Re-run with --execute to cancel selected broker orders.',
  };
}

async function executeCancel(
  registry: BrokerRuntimeRegistry,
  item: OrphanOrderItem,
  livePositionSymbolsByAccount: Map<string, Set<string>>,
  livePositionErrorsByAccount: Map<string, string>
): Promise<CleanupResult> {
  const base = {
    brokerKey: item.brokerKey,
    accountId: item.accountId,
    accountName: item.accountName,
    userId: item.userId,
    symbol: item.symbol,
    externalId: item.externalId,
    kind: item.kind,
    orderStatus: item.orderStatus,
    mode: 'execute' as const,
  };
  const accountKey = livePositionCacheKey(item);
  const livePositionError = livePositionErrorsByAccount.get(accountKey);
  if (livePositionError) {
    return {
      ...base,
      status: 'skipped_live_position_check_failed',
      livePositionCheck: 'failed',
      message: 'Skipped broker cancel because live position verification failed.',
      error: livePositionError,
    };
  }

  const livePositionSymbols = livePositionSymbolsByAccount.get(accountKey) || new Set<string>();
  if (livePositionSymbols.has(item.symbol.toLowerCase())) {
    return {
      ...base,
      status: 'skipped_live_position_found',
      livePositionCheck: 'found_position',
      message: 'Skipped broker cancel because the live broker still reports an open position.',
    };
  }

  try {
    const adapter = registry.getOrdersAdapter(item.brokerKey);
    const response = await adapter.cancelOrder(item.externalId, {
      userId: item.userId,
      brokerKey: item.brokerKey,
      accountId: item.accountId,
    });
    return {
      ...base,
      status: 'cancelled',
      livePositionCheck: 'passed_no_position',
      message: 'Broker cancel requested.',
      response: jsonSafe(response),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isIdempotentCancelError(error)) {
      return {
        ...base,
        status: 'already_terminal',
        livePositionCheck: 'passed_no_position',
        message: 'Broker reported the order is already terminal or missing.',
        error: message,
      };
    }
    return {
      ...base,
      status: 'failed',
      livePositionCheck: 'passed_no_position',
      message: 'Broker cancel failed.',
      error: message,
    };
  }
}

async function persistReport(report: JsonRecord, outputFile: string): Promise<void> {
  if (!outputFile) {
    return;
  }
  const outputPath = path.resolve(process.cwd(), outputFile);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function summarize(results: CleanupResult[]): Record<string, number> {
  return results.reduce<Record<string, number>>((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});
}

async function run(): Promise<void> {
  const options = parseOptions();
  await initializeCoreDataSource();

  const allItems = await loadBrokerOrderOrphans();
  const selectedItems = filterItems(allItems, options);
  const registry = Container.get(BrokerRuntimeRegistry);
  const livePositionSymbolsByAccount = new Map<string, Set<string>>();
  const livePositionErrorsByAccount = new Map<string, string>();

  if (options.execute) {
    for (const item of selectedItems) {
      const accountKey = livePositionCacheKey(item);
      if (
        livePositionSymbolsByAccount.has(accountKey) ||
        livePositionErrorsByAccount.has(accountKey)
      ) {
        continue;
      }
      try {
        livePositionSymbolsByAccount.set(
          accountKey,
          await fetchLivePositionSymbols(registry, item)
        );
      } catch (error) {
        livePositionErrorsByAccount.set(
          accountKey,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  const results: CleanupResult[] = [];
  for (const item of selectedItems) {
    results.push(
      options.execute
        ? await executeCancel(
            registry,
            item,
            livePositionSymbolsByAccount,
            livePositionErrorsByAccount
          )
        : buildDryRunResult(item)
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.execute ? 'execute' : 'dry_run',
    filters: {
      kinds: Array.from(options.kinds).sort(),
      brokerKeys: Array.from(options.brokerKeys).sort(),
      accountIds: Array.from(options.accountIds).sort(),
      symbols: Array.from(options.symbols).sort(),
      orderIds: Array.from(options.orderIds).sort(),
      limit: options.limit,
    },
    totalOrphans: allItems.length,
    selected: selectedItems.length,
    summary: summarize(results),
    postCancelSyncRequired: options.execute,
    results,
  };

  await persistReport(report, options.outputFile);
  console.log(JSON.stringify(report, null, 2));
}

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (coreDataSource.isInitialized) {
      await coreDataSource.destroy();
    }
  });
