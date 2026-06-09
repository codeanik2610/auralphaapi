import { Inject, Service } from 'typedi';
import {
  BrokerReconciliationRunDetailResponse,
  BrokerReconciliationRunItem,
  BrokerReconciliationRunListResponse,
  BrokerReconciliationUnmatchedEvidenceItem,
  BrokerReconciliationUnmatchedEvidenceResponse,
} from '../contracts/BrokerReconciliation';
import { NotFoundAppError } from '../errors/AppError';
import { successResponse } from '../utils/response';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  BrokerReconciliationRepository,
  BrokerReconciliationRunReadRow,
  BrokerReconciliationUnmatchedEvidenceRow,
} from '../../database/repositories/BrokerReconciliationRepository';

export interface BrokerReconciliationRunsQuery {
  limit?: string;
  offset?: string;
  brokerKey?: string;
  accountId?: string;
  status?: string;
  runType?: string;
}

export interface BrokerReconciliationUnmatchedQuery {
  limit?: string;
  offset?: string;
  kind?: string;
}

@Service()
export class BrokerReconciliationReadService {
  @Inject(() => BrokerReconciliationRepository)
  private brokerReconciliationRepository!: BrokerReconciliationRepository;

  async listRuns(
    userId: string,
    query: BrokerReconciliationRunsQuery = {}
  ): Promise<ApiSuccessResponse<BrokerReconciliationRunListResponse>> {
    const limit = this.limit(query.limit, 25, 200);
    const offset = this.offset(query.offset);
    const result = await this.brokerReconciliationRepository.listReconciliationRuns({
      userId,
      limit,
      offset,
      brokerKey: query.brokerKey,
      accountId: query.accountId,
      status: query.status,
      runType: query.runType,
    });

    return successResponse({
      items: result.items.map((item) => this.mapRun(item)),
      total: result.total,
      limit,
      offset,
    });
  }

  async getRunDetail(
    userId: string,
    runId: string
  ): Promise<ApiSuccessResponse<BrokerReconciliationRunDetailResponse>> {
    const run = await this.requireRun(userId, runId);
    const scope = this.scopeFromRun(run);
    const unmatchedEvidence = await this.brokerReconciliationRepository.listUnmatchedEvidence({
      ...scope,
      kind: 'all',
      limit: 10,
      offset: 0,
    });

    return successResponse({
      ...this.mapRun(run),
      unmatchedEvidencePreview: {
        items: unmatchedEvidence.items.map((item) => this.mapUnmatchedEvidence(item)),
        total: unmatchedEvidence.total,
        limit: 10,
        offset: 0,
        kind: 'all',
      },
    });
  }

  async listRunUnmatchedEvidence(
    userId: string,
    runId: string,
    query: BrokerReconciliationUnmatchedQuery = {}
  ): Promise<ApiSuccessResponse<BrokerReconciliationUnmatchedEvidenceResponse>> {
    const run = await this.requireRun(userId, runId);
    const limit = this.limit(query.limit, 25, 200);
    const offset = this.offset(query.offset);
    const kind = this.kind(query.kind);
    const result = await this.brokerReconciliationRepository.listUnmatchedEvidence({
      ...this.scopeFromRun(run),
      kind,
      limit,
      offset,
    });

    return successResponse({
      items: result.items.map((item) => this.mapUnmatchedEvidence(item)),
      total: result.total,
      limit,
      offset,
      kind,
    });
  }

  private async requireRun(userId: string, runId: string): Promise<BrokerReconciliationRunReadRow> {
    const normalizedRunId = String(runId || '').trim();
    if (!normalizedRunId) {
      throw new NotFoundAppError('Broker reconciliation run not found');
    }
    const run = await this.brokerReconciliationRepository.getReconciliationRunById(
      userId,
      normalizedRunId
    );
    if (!run) {
      throw new NotFoundAppError('Broker reconciliation run not found');
    }
    return run;
  }

  private scopeFromRun(run: BrokerReconciliationRunReadRow): {
    userId: string;
    brokerKey: string | null;
    accountId: string | null;
    windowStartAt: Date | null;
    windowEndAt: Date | null;
  } {
    const brokerKey = this.readString(run.broker_key);
    return {
      userId: run.user_id,
      brokerKey: brokerKey === 'all' ? null : brokerKey,
      accountId: this.readString(run.account_id) || null,
      windowStartAt: this.dateOrNull(run.window_start_at),
      windowEndAt: this.dateOrNull(run.window_end_at),
    };
  }

  private mapRun(row: BrokerReconciliationRunReadRow): BrokerReconciliationRunItem {
    return {
      id: row.id,
      userId: row.user_id,
      brokerKey: row.broker_key,
      accountId: row.account_id,
      runType: row.run_type,
      status: row.status,
      windowStartAt: this.toIso(row.window_start_at),
      windowEndAt: this.toIso(row.window_end_at),
      startedAt: this.toIso(row.started_at),
      finishedAt: this.toIso(row.finished_at),
      counts: {
        fills: this.number(row.fills_count),
        feeEntries: this.number(row.fee_entries_count),
        fundingEntries: this.number(row.funding_entries_count),
        walletTransactions: this.number(row.wallet_transactions_count),
        balanceSnapshots: this.number(row.balance_snapshots_count),
      },
      pnl: {
        gross: this.nullableNumber(row.gross_pnl),
        fees: this.nullableNumber(row.fees_total),
        funding: this.nullableNumber(row.funding_total),
        net: this.nullableNumber(row.net_pnl),
        balanceDelta: this.nullableNumber(row.balance_delta),
        unmatchedDelta: this.nullableNumber(row.unmatched_delta),
      },
      summary: this.parseJsonRecord(row.summary_json),
      errorMessage: row.error_message,
      createdAt: this.toIso(row.created_at),
      updatedAt: this.toIso(row.updated_at),
    };
  }

  private mapUnmatchedEvidence(
    row: BrokerReconciliationUnmatchedEvidenceRow
  ): BrokerReconciliationUnmatchedEvidenceItem {
    return {
      kind: row.kind,
      id: row.id,
      brokerKey: row.broker_key,
      accountId: row.account_id,
      externalId: row.external_id,
      symbol: row.symbol,
      orderId: row.order_id,
      positionId: row.position_id,
      suggestedTradeId: row.suggested_trade_id,
      side: row.side,
      amount: this.nullableNumber(row.amount),
      quantity: this.nullableNumber(row.quantity),
      price: this.nullableNumber(row.price),
      occurredAt: this.toIso(row.occurred_at),
      matchState: row.match_state,
      matchConfidence: row.match_confidence,
      source: row.source,
      rawPayload: this.parseJsonRecord(row.raw_payload_json),
    };
  }

  private parseJsonRecord(value: unknown): Record<string, unknown> | null {
    if (!value) {
      return null;
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  private limit(value: unknown, fallback: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.min(parsed, max);
  }

  private offset(value: unknown): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  }

  private kind(value: unknown): string {
    const normalized = this.readString(value).toLowerCase();
    return ['fills', 'fees', 'funding', 'wallet', 'all'].includes(normalized) ? normalized : 'all';
  }

  private nullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private number(value: unknown): number {
    return this.nullableNumber(value) ?? 0;
  }

  private toIso(value: unknown): string | null {
    const date = this.dateOrNull(value);
    return date ? date.toISOString() : null;
  }

  private dateOrNull(value: unknown): Date | null {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private readString(value: unknown): string {
    return value === null || value === undefined ? '' : String(value).trim();
  }
}
