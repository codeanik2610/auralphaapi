import { Inject, Service } from 'typedi';
import { BrokerAccount } from '../../database/entities/BrokerAccount';
import { BrokerAccountRepository } from '../../database/repositories/BrokerAccountRepository';
import { env } from '../../env';
import {
  BrokerReconciliationBatchAccountResult,
  BrokerReconciliationBatchAccountScope,
  BrokerReconciliationBatchBody,
  BrokerReconciliationBatchResponse,
  BrokerReconciliationBatchStepResult,
} from '../contracts/BrokerReconciliation';
import { BrokerReconciliationMatchService } from './BrokerReconciliationMatchService';
import { DeltaBrokerReconciliationSyncService } from './DeltaBrokerReconciliationSyncService';
import { MudrexBrokerReconciliationSyncService } from './MudrexBrokerReconciliationSyncService';

interface ResolvedBatchAccount {
  userId: string | null;
  brokerKey: string;
  accountId: string;
}

@Service()
export class BrokerReconciliationBatchService {
  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => BrokerReconciliationMatchService)
  private brokerReconciliationMatchService!: BrokerReconciliationMatchService;

  @Inject(() => DeltaBrokerReconciliationSyncService)
  private deltaBrokerReconciliationSyncService!: DeltaBrokerReconciliationSyncService;

  @Inject(() => MudrexBrokerReconciliationSyncService)
  private mudrexBrokerReconciliationSyncService!: MudrexBrokerReconciliationSyncService;

  async runBatch(
    body: BrokerReconciliationBatchBody = {}
  ): Promise<BrokerReconciliationBatchResponse> {
    const startedAt = new Date();
    const syncEnabled = body.sync !== false;
    const matchEnabled = body.match !== false;
    const accounts = await this.resolveAccounts(body);
    const results: BrokerReconciliationBatchAccountResult[] = [];

    for (const account of accounts) {
      results.push(await this.runAccount(account, body, syncEnabled, matchEnabled));
    }

    const finishedAt = new Date();
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      requested: {
        sync: syncEnabled,
        match: matchEnabled,
        startDate: this.readString(body.startDate),
        endDate: this.readString(body.endDate),
        fallbackWindowMinutes:
          typeof body.fallbackWindowMinutes === 'number' ? body.fallbackWindowMinutes : null,
      },
      summary: {
        totalAccounts: results.length,
        completedAccounts: results.filter((item) => item.status === 'completed').length,
        skippedAccounts: results.filter((item) => item.status === 'skipped').length,
        unsupportedBrokerAccounts: results.filter((item) => item.status === 'unsupported_broker')
          .length,
        syncFailedAccounts: results.filter((item) => item.status === 'sync_failed').length,
        matchFailedAccounts: results.filter((item) => item.status === 'match_failed').length,
      },
      results,
    };
  }

  private async resolveAccounts(
    body: BrokerReconciliationBatchBody
  ): Promise<ResolvedBatchAccount[]> {
    const explicitAccounts = Array.isArray(body.accounts)
      ? body.accounts.map((account) => this.normalizeAccountScope(account))
      : [];

    const brokerKeyFilter = new Set(
      this.normalizeStrings(body.brokerKeys).map((item) => item.toLowerCase())
    );
    const accountIdFilter = new Set(this.normalizeStrings(body.accountIds));
    const scopedAccounts = explicitAccounts.length
      ? explicitAccounts
      : await this.resolveRepositoryAccounts(body, brokerKeyFilter, accountIdFilter);

    return this.dedupeAccounts(
      scopedAccounts.filter((account) =>
        this.accountMatchesFilters(account, brokerKeyFilter, accountIdFilter)
      )
    );
  }

  private async resolveRepositoryAccounts(
    body: BrokerReconciliationBatchBody,
    brokerKeyFilter: ReadonlySet<string>,
    accountIdFilter: ReadonlySet<string>
  ): Promise<ResolvedBatchAccount[]> {
    const targetUserIds = this.normalizeTargetUserIds(body.targetUserIds);
    const isInfraAllAccountsRequest =
      targetUserIds.length === 1 && targetUserIds[0] === env.scheduler.systemUserId;

    if (isInfraAllAccountsRequest) {
      return this.accountsFromEntities(
        await this.brokerAccountRepository.getAllActiveBrokerAccounts(),
        brokerKeyFilter,
        accountIdFilter
      );
    }

    const accountGroups = await Promise.all(
      targetUserIds.map(async (userId) => {
        const accounts = await this.brokerAccountRepository.getActiveBrokerAccounts(userId);
        return this.accountsFromEntities(accounts, brokerKeyFilter, accountIdFilter);
      })
    );
    return accountGroups.flat();
  }

  private accountsFromEntities(
    accounts: BrokerAccount[],
    brokerKeyFilter: ReadonlySet<string>,
    accountIdFilter: ReadonlySet<string>
  ): ResolvedBatchAccount[] {
    return accounts
      .map((account) => ({
        userId: this.readString(account.userId),
        brokerKey: this.readString(account.brokerKey) || '',
        accountId: this.readString(account.id) || '',
      }))
      .filter((account) => this.accountMatchesFilters(account, brokerKeyFilter, accountIdFilter));
  }

  private async runAccount(
    account: ResolvedBatchAccount,
    body: BrokerReconciliationBatchBody,
    syncEnabled: boolean,
    matchEnabled: boolean
  ): Promise<BrokerReconciliationBatchAccountResult> {
    const sync = this.skippedStep();
    const match = this.skippedStep();
    const brokerKey = account.brokerKey.toLowerCase();

    if (!account.userId) {
      return this.accountResult(
        account,
        'skipped',
        sync,
        match,
        'Broker account is missing userId.'
      );
    }

    if (brokerKey !== 'mudrex' && brokerKey !== 'delta_exchange') {
      return this.accountResult(
        account,
        'unsupported_broker',
        sync,
        match,
        `Broker ${account.brokerKey} is not supported by reconciliation batch sync.`
      );
    }

    if (!syncEnabled && !matchEnabled) {
      return this.accountResult(account, 'skipped', sync, match);
    }

    if (syncEnabled) {
      try {
        const syncResult =
          brokerKey === 'mudrex'
            ? await this.mudrexBrokerReconciliationSyncService.syncAccount({
                userId: account.userId,
                accountId: account.accountId,
                startDate: this.readString(body.startDate),
                endDate: this.readString(body.endDate),
              })
            : await this.deltaBrokerReconciliationSyncService.syncAccount({
                userId: account.userId,
                accountId: account.accountId,
                startDate: this.readString(body.startDate),
                endDate: this.readString(body.endDate),
              });
        sync.status = 'completed';
        sync.runId = syncResult.runId;
      } catch (error) {
        sync.status = 'failed';
        sync.errorMessage = this.errorMessage(error);
        return this.accountResult(account, 'sync_failed', sync, match);
      }
    }

    if (matchEnabled) {
      try {
        const matchResult = await this.brokerReconciliationMatchService.matchAndCompare({
          userId: account.userId,
          brokerKey,
          accountId: account.accountId,
          startDate: this.readString(body.startDate),
          endDate: this.readString(body.endDate),
          fallbackWindowMinutes:
            typeof body.fallbackWindowMinutes === 'number' ? body.fallbackWindowMinutes : null,
        });
        match.status = 'completed';
        match.runId = matchResult.runId;
      } catch (error) {
        match.status = 'failed';
        match.errorMessage = this.errorMessage(error);
        return this.accountResult(account, 'match_failed', sync, match);
      }
    }

    return this.accountResult(account, 'completed', sync, match);
  }

  private accountResult(
    account: ResolvedBatchAccount,
    status: BrokerReconciliationBatchAccountResult['status'],
    sync: BrokerReconciliationBatchStepResult,
    match: BrokerReconciliationBatchStepResult,
    skippedReason?: string
  ): BrokerReconciliationBatchAccountResult {
    const result = {
      userId: account.userId,
      brokerKey: account.brokerKey,
      accountId: account.accountId,
      status,
      sync,
      match,
    };

    if (skippedReason && sync.status === 'skipped' && match.status === 'skipped') {
      return {
        ...result,
        sync: { ...sync, errorMessage: skippedReason },
        match: { ...match, errorMessage: skippedReason },
      };
    }

    return result;
  }

  private normalizeAccountScope(
    account: BrokerReconciliationBatchAccountScope
  ): ResolvedBatchAccount {
    return {
      userId: this.readString(account.userId),
      brokerKey: (this.readString(account.brokerKey) || '').toLowerCase(),
      accountId: this.readString(account.accountId) || '',
    };
  }

  private normalizeTargetUserIds(value: unknown): string[] {
    const userIds = this.normalizeStrings(value);
    return userIds.length ? userIds : [env.scheduler.systemUserId];
  }

  private normalizeStrings(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
  }

  private dedupeAccounts(accounts: ResolvedBatchAccount[]): ResolvedBatchAccount[] {
    const seen = new Set<string>();
    const deduped: ResolvedBatchAccount[] = [];
    for (const account of accounts) {
      if (!account.accountId || !account.brokerKey) {
        continue;
      }
      const key = `${account.userId || ''}:${account.brokerKey.toLowerCase()}:${account.accountId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(account);
    }
    return deduped.sort((left, right) =>
      `${left.userId || ''}:${left.brokerKey}:${left.accountId}`.localeCompare(
        `${right.userId || ''}:${right.brokerKey}:${right.accountId}`
      )
    );
  }

  private accountMatchesFilters(
    account: ResolvedBatchAccount,
    brokerKeyFilter: ReadonlySet<string>,
    accountIdFilter: ReadonlySet<string>
  ): boolean {
    if (brokerKeyFilter.size > 0 && !brokerKeyFilter.has(account.brokerKey.toLowerCase())) {
      return false;
    }
    if (accountIdFilter.size > 0 && !accountIdFilter.has(account.accountId)) {
      return false;
    }
    return true;
  }

  private skippedStep(): BrokerReconciliationBatchStepResult {
    return { status: 'skipped', runId: null, errorMessage: null };
  }

  private readString(value: unknown): string | null {
    const text = String(value || '').trim();
    return text || null;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
