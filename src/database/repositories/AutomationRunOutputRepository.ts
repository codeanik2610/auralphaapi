import { randomUUID } from 'node:crypto';
import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { AutomationRunOutput } from '../entities/AutomationRunOutput';

export interface CreateAutomationRunOutputPayload {
  automationId: string;
  automationRunId: string;
  userId: string;
  suggestedTradeId?: string | null;
  outputType: string;
  status?: string;
  title?: string | null;
  dedupeKey?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface SuggestedTradeGenerationMetrics {
  summaryRuns: number;
  suggestedTradesCreated: number;
  duplicateSuggestions: number;
}

@Service()
export class AutomationRunOutputRepository {
  private get repository(): Repository<AutomationRunOutput> {
    return coreDataSource.getRepository(AutomationRunOutput);
  }

  async createOutput(
    payload: CreateAutomationRunOutputPayload
  ): Promise<AutomationRunOutput> {
    const dedupeKey = payload.dedupeKey?.trim() || null;
    if (dedupeKey) {
      const existing = await this.repository.findOne({
        where: {
          automationRunId: payload.automationRunId,
          outputType: payload.outputType,
          dedupeKey,
        },
      });
      if (existing) {
        return existing;
      }
    }

    const entity = this.repository.create({
      id: randomUUID(),
      automationId: payload.automationId,
      automationRunId: payload.automationRunId,
      userId: payload.userId,
      suggestedTradeId: payload.suggestedTradeId ?? null,
      outputType: payload.outputType,
      status: payload.status?.trim() || 'Created',
      title: payload.title ?? null,
      dedupeKey,
      payload: payload.payload ?? null,
    });

    return this.repository.save(entity);
  }

  async listByAutomationRun(
    automationRunId: string
  ): Promise<AutomationRunOutput[]> {
    return this.repository.find({
      where: { automationRunId },
      order: { createdAt: 'DESC' },
    });
  }

  async getSuggestedTradeGenerationMetrics(
    createdAfter: Date
  ): Promise<SuggestedTradeGenerationMetrics> {
    const rows = (await coreDataSource.query(
      `
        SELECT
          COUNT(*) AS summaryRuns,
          COALESCE(
            SUM(
              CASE
                WHEN JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.suggestedTradesCount')) IS NULL THEN 0
                ELSE CAST(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.suggestedTradesCount')) AS SIGNED)
              END
            ),
            0
          ) AS suggestedTradesCreated,
          COALESCE(
            SUM(
              CASE
                WHEN JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.duplicateSuggestionsCount')) IS NULL THEN 0
                ELSE CAST(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.duplicateSuggestionsCount')) AS SIGNED)
              END
            ),
            0
          ) AS duplicateSuggestions
        FROM automation_run_outputs
        WHERE output_type = 'trade-suggestion.summary'
          AND created_at >= ?
      `,
      [createdAfter]
    )) as Array<{
      summaryRuns?: string | number | null;
      suggestedTradesCreated?: string | number | null;
      duplicateSuggestions?: string | number | null;
    }>;

    const row = rows[0] || {};
    return {
      summaryRuns: Number(row.summaryRuns || 0),
      suggestedTradesCreated: Number(row.suggestedTradesCreated || 0),
      duplicateSuggestions: Number(row.duplicateSuggestions || 0),
    };
  }
}
