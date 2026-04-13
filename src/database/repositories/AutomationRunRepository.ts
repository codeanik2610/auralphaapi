import { Service } from 'typedi';
import { In, Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { AutomationRun } from '../entities/AutomationRun';

export interface AutomationRunStaleQuery {
  olderThan: Date;
  limit?: number;
  automationId?: string;
  userId?: string;
  workerId?: string | null;
  statuses?: string[];
}

export interface AutomationRunRepairPayload {
  status: string;
  reason: string;
  finishedAt?: Date;
  repairedAt?: Date;
  workerId?: string | null;
}

@Service()
export class AutomationRunRepository {
  private get repository(): Repository<AutomationRun> {
    return coreDataSource.getRepository(AutomationRun);
  }

  async createRun(payload: Partial<AutomationRun>): Promise<AutomationRun> {
    const created = this.repository.create(payload);
    if (
      !created.lastProgressAt &&
      (created.status === 'Running' || created.status === 'Queued')
    ) {
      created.lastProgressAt = created.startedAt ?? new Date();
    }
    return this.repository.save(created);
  }

  async updateRun(runId: string, payload: Partial<AutomationRun>): Promise<void> {
    await this.repository.update({ id: runId }, payload as any);
  }

  async assignRunOwnership(
    runId: string,
    ownership: {
      workerId?: string | null;
      lastProgressAt?: Date | null;
    }
  ): Promise<void> {
    const payload: Partial<AutomationRun> = {};
    if (ownership.workerId !== undefined) {
      payload.workerId = ownership.workerId;
    }
    if (ownership.lastProgressAt !== undefined) {
      payload.lastProgressAt = ownership.lastProgressAt;
    }

    if (!Object.keys(payload).length) {
      return;
    }

    await this.updateRun(runId, payload);
  }

  async touchRunProgress(
    runId: string,
    lastProgressAt = new Date(),
    workerId?: string | null
  ): Promise<void> {
    const payload: Partial<AutomationRun> = {
      lastProgressAt,
    };
    if (workerId !== undefined) {
      payload.workerId = workerId;
    }
    await this.updateRun(runId, payload);
  }

  async findStaleRuns(query: AutomationRunStaleQuery): Promise<AutomationRun[]> {
    const statuses = Array.isArray(query.statuses) && query.statuses.length
      ? query.statuses
      : ['Queued', 'Running'];

    const builder = this.repository
      .createQueryBuilder('automation_run')
      .where('automation_run.status IN (:...statuses)', { statuses })
      .andWhere(
        '(automation_run.last_progress_at IS NULL OR automation_run.last_progress_at < :olderThan)',
        {
          olderThan: query.olderThan,
        }
      );

    if (query.automationId) {
      builder.andWhere('automation_run.automation_id = :automationId', {
        automationId: query.automationId,
      });
    }

    if (query.userId) {
      builder.andWhere('automation_run.user_id = :userId', {
        userId: query.userId,
      });
    }

    if (query.workerId === null) {
      builder.andWhere('automation_run.worker_id IS NULL');
    } else if (typeof query.workerId === 'string' && query.workerId.trim()) {
      builder.andWhere('automation_run.worker_id = :workerId', {
        workerId: query.workerId.trim(),
      });
    }

    return builder
      .orderBy('automation_run.last_progress_at', 'ASC')
      .addOrderBy('automation_run.started_at', 'ASC')
      .take(query.limit ?? 100)
      .getMany();
  }

  async markRunRepaired(
    runId: string,
    payload: AutomationRunRepairPayload
  ): Promise<AutomationRun | null> {
    const existing = await this.findById(runId);
    if (!existing) {
      return null;
    }

    const repairedAt = payload.repairedAt ?? new Date();
    const finishedAt = payload.finishedAt ?? repairedAt;
    const durationMs = Math.max(0, finishedAt.getTime() - existing.startedAt.getTime());

    await this.repository.update(
      { id: runId },
      {
        status: payload.status,
        finishedAt,
        durationMs,
        errorMessage: payload.reason,
        repairedAt,
        repairReason: payload.reason,
        workerId: payload.workerId ?? null,
        lastProgressAt: finishedAt,
      } as any
    );

    return this.findById(runId);
  }

  async findRunningByAutomationId(automationId: string): Promise<AutomationRun | null> {
    return this.repository.findOne({
      where: { automationId, status: 'Running' },
    });
  }

  async findByAutomationAndScheduled(
    automationId: string,
    scheduledFor: Date
  ): Promise<AutomationRun | null> {
    return this.repository.findOne({
      where: { automationId, scheduledFor },
    });
  }

  async findById(runId: string): Promise<AutomationRun | null> {
    return this.repository.findOne({
      where: { id: runId },
    });
  }

  async listRunsByAutomationStatuses(
    automationId: string,
    userId: string,
    statuses: string[],
    limit = 25
  ): Promise<AutomationRun[]> {
    if (!statuses.length) {
      return [];
    }

    return this.repository.find({
      where: statuses.map((status) => ({
        automationId,
        userId,
        status,
      })),
      order: { startedAt: 'DESC' },
      take: limit,
    });
  }

  async listRunsByAutomation(
    automationId: string,
    userId: string,
    limit: number,
    offset: number
  ): Promise<{ items: AutomationRun[]; total: number }> {
    const [items, total] = await this.repository.findAndCount({
      where: { automationId, userId },
      order: { startedAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { items, total };
  }

  async getUserRunDiagnostics(
    userId: string,
    since: Date
  ): Promise<{
    activeRuns: number;
    failedRuns24h: number;
  }> {
    return this.readRunDiagnostics(userId, since);
  }

  async getOperationalRunDiagnostics(since: Date): Promise<{
    activeRuns: number;
    failedRuns24h: number;
  }> {
    return this.readRunDiagnostics(null, since);
  }

  private async readRunDiagnostics(
    userId: string | null,
    since: Date
  ): Promise<{
    activeRuns: number;
    failedRuns24h: number;
  }> {
    const [activeRuns, failedRuns24h] = await Promise.all([
      this.repository.count({
        where: {
          ...(userId ? { userId } : {}),
          status: In(['Running', 'Queued']),
        } as any,
      }),
      (() => {
        const builder = this.repository
          .createQueryBuilder('automation_run')
          .where('automation_run.status = :status', { status: 'Failed' })
          .andWhere('automation_run.startedAt >= :since', { since });

        if (userId) {
          builder.andWhere('automation_run.userId = :userId', { userId });
        }

        return builder.getCount();
      })(),
    ]);

    return {
      activeRuns,
      failedRuns24h,
    };
  }
}
