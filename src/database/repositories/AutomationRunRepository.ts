import { Service } from 'typedi';
import { In, Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { AutomationRun } from '../entities/AutomationRun';

@Service()
export class AutomationRunRepository {
  private get repository(): Repository<AutomationRun> {
    return coreDataSource.getRepository(AutomationRun);
  }

  async createRun(payload: Partial<AutomationRun>): Promise<AutomationRun> {
    const created = this.repository.create(payload);
    return this.repository.save(created);
  }

  async updateRun(runId: string, payload: Partial<AutomationRun>): Promise<void> {
    await this.repository.update({ id: runId }, payload as any);
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
