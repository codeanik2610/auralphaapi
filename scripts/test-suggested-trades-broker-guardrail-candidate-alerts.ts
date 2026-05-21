import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  type BrokerGuardrailAlertRepository,
  type BrokerGuardrailCandidateAlertPlan,
  type BrokerGuardrailOpenAlert,
  type BrokerGuardrailRepairPreviewItem,
  buildBrokerGuardrailCandidateAlertPlan,
  buildBrokerGuardrailCandidateAlertPlans,
  emitBrokerGuardrailCandidateAlert,
} from './checks/check-suggested-trades-broker-guardrail-candidate-alerts';

function buildPreviewItem(
  overrides: Partial<BrokerGuardrailRepairPreviewItem>
): BrokerGuardrailRepairPreviewItem {
  return {
    suggestedTradeId: 'suggested-trade-1234567890',
    userId: 'user-1',
    accountId: 'account-1',
    symbol: 'BTCUSDT',
    timeframe: '5m',
    side: 'BUY',
    entryOrderId: 'entry-order-123',
    positionId: 'position-123',
    positionReadModelExternalId: 'position-123',
    issues: ['missing_active_stop_loss', 'missing_active_take_profit'],
    reasons: ['missing protection'],
    remediation: {
      action: 'would_attach_missing_protection',
      readiness: 'ready',
      repairable: true,
      blockers: [],
      notes: [],
      expectedMutation: {
        positionId: 'position-123',
      },
    },
    ...overrides,
  };
}

class FakeAlertRepository implements BrokerGuardrailAlertRepository {
  existingBySource: BrokerGuardrailOpenAlert | null = null;
  existingBySignature: BrokerGuardrailOpenAlert | null = null;
  createdPayloads: unknown[] = [];
  updates: Array<{
    userId: string;
    alertId: string;
    payload: Partial<
      Pick<BrokerGuardrailOpenAlert, 'severity' | 'symbol' | 'message' | 'route' | 'urgency'>
    >;
  }> = [];
  createResult: unknown | null = { id: 'created-alert-1' };

  async findOpenAlertBySource(): Promise<BrokerGuardrailOpenAlert | null> {
    return this.existingBySource;
  }

  async findOpenAlertBySignature(): Promise<BrokerGuardrailOpenAlert | null> {
    return this.existingBySignature;
  }

  async updateOpenAlertDetails(
    userId: string,
    alertId: string,
    payload: Partial<
      Pick<BrokerGuardrailOpenAlert, 'severity' | 'symbol' | 'message' | 'route' | 'urgency'>
    >
  ): Promise<void> {
    this.updates.push({ userId, alertId, payload });
  }

  async createAlert(payload: unknown): Promise<unknown | null> {
    this.createdPayloads.push(payload);
    return this.createResult;
  }
}

function assertPlan(
  plan: BrokerGuardrailCandidateAlertPlan | null
): BrokerGuardrailCandidateAlertPlan {
  assert.ok(plan);
  return plan;
}

function testBuildsHighPriorityReadyAlertPlan(): void {
  const plan = assertPlan(buildBrokerGuardrailCandidateAlertPlan('mudrex', buildPreviewItem({})));

  assert.equal(plan.brokerKey, 'mudrex');
  assert.equal(plan.severity, 'High');
  assert.equal(plan.urgency, 'immediate');
  assert.equal(plan.route, 'Broker Guardrails');
  assert.equal(plan.symbol, 'BTCUSDT');
  assert.equal(plan.positionId, 'position-123');
  assert.equal(plan.source.length <= 100, true);
  assert.equal(plan.message.length <= 255, true);
  assert.equal(plan.message.includes('Mudrex BTCUSDT guardrail'), true);
}

function testBuildsReviewAlertPlanForBlockedDeltaCandidate(): void {
  const plan = assertPlan(
    buildBrokerGuardrailCandidateAlertPlan(
      'delta_exchange',
      buildPreviewItem({
        remediation: {
          action: 'would_reconcile_native_bracket_protection',
          readiness: 'blocked',
          repairable: false,
          blockers: ['missing planned stop-loss price'],
          expectedMutation: {},
        },
      })
    )
  );

  assert.equal(plan.brokerKey, 'delta_exchange');
  assert.equal(plan.severity, 'Medium');
  assert.equal(plan.urgency, 'review');
  assert.deepEqual(plan.blockers, ['missing planned stop-loss price']);
  assert.equal(plan.message.includes('Delta BTCUSDT guardrail'), true);
  assert.equal(plan.message.includes('blockers=missing planned stop-loss price'), true);
}

function testReportPlanBuilderLimitsCombinedBrokerItems(): void {
  const mudrexItem = buildPreviewItem({ suggestedTradeId: 'mudrex-1' });
  const deltaItem = buildPreviewItem({ suggestedTradeId: 'delta-1' });
  const plans = buildBrokerGuardrailCandidateAlertPlans({
    mudrex: {
      audited: 1,
      issueTrades: 1,
      repairableItems: 1,
      blockedItems: 0,
      manualReviewItems: 0,
      items: [mudrexItem],
    } as never,
    delta: {
      audited: 1,
      issueTrades: 1,
      repairableItems: 1,
      blockedItems: 0,
      manualReviewItems: 0,
      items: [deltaItem],
    } as never,
    limit: 1,
  });

  assert.equal(plans.length, 1);
  assert.equal(plans[0].brokerKey, 'mudrex');
}

async function testCreateAlertForNewCandidate(): Promise<void> {
  const repo = new FakeAlertRepository();
  const plan = assertPlan(buildBrokerGuardrailCandidateAlertPlan('mudrex', buildPreviewItem({})));
  const disposition = await emitBrokerGuardrailCandidateAlert(repo, plan);

  assert.equal(disposition, 'created');
  assert.equal(repo.createdPayloads.length, 1);
  assert.deepEqual(repo.updates, []);
  assert.equal(
    (repo.createdPayloads[0] as { suppressEmailDelivery: boolean }).suppressEmailDelivery,
    false
  );
}

async function testUpdateExistingAlertWhenDetailsChange(): Promise<void> {
  const repo = new FakeAlertRepository();
  const plan = assertPlan(buildBrokerGuardrailCandidateAlertPlan('mudrex', buildPreviewItem({})));
  repo.existingBySource = {
    id: 'alert-1',
    severity: 'Medium',
    symbol: 'OLD',
    message: 'old message',
    route: 'Old',
    urgency: 'review',
  };

  const disposition = await emitBrokerGuardrailCandidateAlert(repo, plan);

  assert.equal(disposition, 'updated');
  assert.equal(repo.createdPayloads.length, 0);
  assert.equal(repo.updates.length, 1);
  assert.equal(repo.updates[0].payload.severity, 'High');
}

async function testDryRunDoesNotWriteAlert(): Promise<void> {
  const repo = new FakeAlertRepository();
  const plan = assertPlan(buildBrokerGuardrailCandidateAlertPlan('mudrex', buildPreviewItem({})));
  const disposition = await emitBrokerGuardrailCandidateAlert(repo, plan, { dryRun: true });

  assert.equal(disposition, 'dry_run');
  assert.equal(repo.createdPayloads.length, 0);
  assert.deepEqual(repo.updates, []);
}

function testWatchdogPersistsAppendOnlyCandidateHistory(): void {
  const runnerSource = readFileSync(
    'scripts/checks/run-suggested-trades-broker-guardrail-candidate-alerts-watchdog.sh',
    'utf8'
  );

  assert.equal(
    runnerSource.includes('AURALPHA_BROKER_GUARDRAIL_ALERT_HISTORY_DIR'),
    true,
    'candidate alert watchdog must allow a configurable history directory'
  );
  assert.equal(
    runnerSource.includes('history_output="${HISTORY_DIR}/${timestamp:0:8}.jsonl"'),
    true,
    'candidate alert watchdog must persist daily JSONL history'
  );
  assert.equal(
    runnerSource.includes('printf \'%s\\n\' "${json_line}" >>"${history_output}"'),
    true,
    'candidate alert watchdog must append reports instead of overwriting history'
  );
  assert.equal(
    runnerSource.includes('history=${history_output}'),
    true,
    'candidate alert watchdog must print the history artifact path'
  );
}

async function run(): Promise<void> {
  testBuildsHighPriorityReadyAlertPlan();
  testBuildsReviewAlertPlanForBlockedDeltaCandidate();
  testReportPlanBuilderLimitsCombinedBrokerItems();
  await testCreateAlertForNewCandidate();
  await testUpdateExistingAlertWhenDetailsChange();
  await testDryRunDoesNotWriteAlert();
  testWatchdogPersistsAppendOnlyCandidateHistory();

  console.log('suggested-trades broker guardrail candidate alert tests passed');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
