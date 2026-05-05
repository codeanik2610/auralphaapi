import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const servicesDir = path.join(process.cwd(), 'src', 'api', 'services');
const mutationMethodPattern =
  /async\s+(create|update|save|sync|trigger|pause|resume|promote|acknowledge|mute|close|cancel|add|reverse|send|import|clone|upsert)[A-Za-z0-9_]*\s*\(/;

const allowListMissingFailureAlert = new Set<string>([
  // Read/summary services can remain out. This list is only for mutation-class methods.
  'RuntimeDiagnosticsService.ts',
]);

function runOperationalAudit(): void {
  const files = fs
    .readdirSync(servicesDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => path.join(servicesDir, name));

  const findings: string[] = [];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    if (!mutationMethodPattern.test(source)) {
      continue;
    }

    const hasActivity = source.includes('logActivity(') || source.includes('createActivityLog(');
    const hasFailureAlert =
      source.includes('emitFailureAlert(') || source.includes('createAlert(');
    const baseName = path.basename(file);

    if (!hasActivity) {
      findings.push(`${baseName}: missing activity logging for mutation methods`);
    }
    if (!hasFailureAlert && !allowListMissingFailureAlert.has(baseName)) {
      findings.push(`${baseName}: missing failure alert emission for mutation methods`);
    }
  }

  const operationalEventServicePath = path.join(servicesDir, 'OperationalEventService.ts');
  const operationalEventServiceSource = fs.readFileSync(operationalEventServicePath, 'utf8');
  if (!operationalEventServiceSource.includes('findRecentOpenAlertBySource')) {
    findings.push(
      'OperationalEventService.ts: missing alert throttle lookup (findRecentOpenAlertBySource)'
    );
  }
  if (!operationalEventServiceSource.includes('failureAlertThrottleMinutes')) {
    findings.push('OperationalEventService.ts: missing throttle window config usage');
  }

  const activityRepositoryPath = path.join(
    process.cwd(),
    'src',
    'database',
    'repositories',
    'ActivityRepository.ts'
  );
  const activityRepositorySource = fs.readFileSync(activityRepositoryPath, 'utf8');
  for (const marker of [
    'normalizeActivityStatus(',
    'normalizeActivityStream(',
    'normalizeActivityRoute(',
    'tokenizeActivitySearch(',
    'countOlderThanDays(',
    'deleteOlderThanDays(',
  ]) {
    if (!activityRepositorySource.includes(marker)) {
      findings.push(`ActivityRepository.ts: missing sprint 5/6 activity capability ${marker}`);
    }
  }

  const activityMaintenanceServicePath = path.join(
    process.cwd(),
    'src',
    'api',
    'services',
    'ActivityMaintenanceService.ts'
  );
  const activityMaintenanceServiceSource = fs.readFileSync(
    activityMaintenanceServicePath,
    'utf8'
  );
  for (const marker of ['runMaintenanceNow()', 'countExpiredExports', 'deleteExpiredExports']) {
    if (!activityMaintenanceServiceSource.includes(marker)) {
      findings.push(
        `ActivityMaintenanceService.ts: missing activity maintenance marker ${marker}`
      );
    }
  }

  const appSource = fs.readFileSync(path.join(process.cwd(), 'app.ts'), 'utf8');
  if (!appSource.includes('activityMaintenanceLoader')) {
    findings.push('app.ts: missing activity maintenance loader wiring');
  }
  for (const marker of [
    'shutdownDrainTimeoutMs',
    'API runtime shutdown completed successfully',
    'closeHttpServer(server)',
  ]) {
    if (!appSource.includes(marker)) {
      findings.push(`app.ts: missing runtime drain marker ${marker}`);
    }
  }

  const emailWorkerAppSource = fs.readFileSync(
    path.join(process.cwd(), 'app.email-worker.ts'),
    'utf8'
  );
  for (const marker of ['draining email worker', 'worker.stop()', 'shutdownDrainTimeoutMs']) {
    if (!emailWorkerAppSource.includes(marker)) {
      findings.push(`app.email-worker.ts: missing runtime drain marker ${marker}`);
    }
  }

  const runtimeDiagnosticsSource = fs.readFileSync(
    path.join(servicesDir, 'RuntimeDiagnosticsService.ts'),
    'utf8'
  );
  for (const marker of [
    'getRuntimeOverview(',
    'listStaleItems(',
    'repairSchedulerCommand(',
    'repairSchedulerRun(',
    'repairAutomationRun(',
    'repairActivityExport(',
    'requeueScheduler(',
    'releaseSchedulerLock(',
    'fetchDiscoveryRuntimePayload(',
  ]) {
    if (!runtimeDiagnosticsSource.includes(marker)) {
      findings.push(`RuntimeDiagnosticsService.ts: missing runtime operator marker ${marker}`);
    }
  }

  const runtimeControllerSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'api', 'controllers', 'InternalRuntimeController.ts'),
    'utf8'
  );
  for (const marker of [
    "@JsonController('/internal/runtime')",
    "@Get('/overview')",
    "@Get('/stale-items')",
    "@Post('/repair/scheduler-command/:commandId')",
    "@Post('/repair/scheduler-run/:runId')",
    "@Post('/repair/automation-run/:runId')",
    "@Post('/repair/activity-export/:exportId')",
    "@Post('/requeue/scheduler/:schedulerKey')",
    "@Post('/release-lock/:schedulerKey')",
  ]) {
    if (!runtimeControllerSource.includes(marker)) {
      findings.push(`InternalRuntimeController.ts: missing runtime API marker ${marker}`);
    }
  }

  const envSource = fs.readFileSync(path.join(process.cwd(), 'src', 'env.ts'), 'utf8');
  for (const marker of [
    'OPS_ACTIVITY_READ_WARN_MS',
    'OPS_ACTIVITY_WRITE_WARN_MS',
    'OPS_ACTIVITY_FEED_VOLUME_INFO_THRESHOLD',
    'ACTIVITY_MAINTENANCE_ENABLED',
    'ACTIVITY_RETENTION_DAYS',
    'ACTIVITY_EXPORT_RETENTION_DAYS',
    'SUGGESTED_TRADES_ROLLOUT_ENABLED',
    'SUGGESTED_TRADES_ROLLOUT_STAGE',
  ]) {
    if (!envSource.includes(marker)) {
      findings.push(`env.ts: missing activity observability/retention config ${marker}`);
    }
  }

  const packageSource = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8');
  for (const marker of [
    '"check:overview-health"',
    '"release-gate:overview"',
    '"signoff:overview"',
    '"check:orders-health"',
    '"release-gate:orders"',
    '"signoff:orders"',
    '"proof:orders-live"',
    '"check:orders-scheduler-health"',
    '"release-gate:orders-scheduler"',
    '"signoff:orders-scheduler"',
    '"check:positions-scheduler-health"',
    '"release-gate:positions-scheduler"',
    '"signoff:positions-scheduler"',
    '"proof:positions-scheduler-live"',
    '"check:funds-scheduler-health"',
    '"release-gate:funds-scheduler"',
    '"signoff:funds-scheduler"',
    '"proof:funds-scheduler-live"',
    '"proof:funds-scheduler-promotion"',
    '"check:scheduler-account-scope-live"',
    '"release-gate:scheduler-account-scope"',
    '"signoff:scheduler-account-scope"',
    '"proof:scheduler-account-scope-live"',
    '"proof:orders-scheduler-live"',
    '"check:broker-assets-health"',
    '"release-gate:broker-assets"',
    '"signoff:broker-assets"',
    '"proof:broker-assets-live"',
    '"check:asset-price-sync-health"',
    '"release-gate:asset-price-sync"',
    '"signoff:asset-price-sync"',
    '"proof:asset-price-sync-live"',
    '"check:global-system-schedulers-health"',
    '"release-gate:global-system-schedulers"',
    '"signoff:global-system-schedulers"',
    '"proof:global-system-schedulers-live"',
    '"test:runtime-recovery"',
    '"check:runtime-health"',
    '"smoke:runtime-recovery"',
    '"release-gate:runtime-recovery"',
    '"signoff:runtime-recovery"',
    '"check:portfolio-health"',
    '"release-gate:portfolio"',
    '"signoff:portfolio"',
    '"proof:portfolio-live"',
    '"smoke:suggested-trades-lifecycle"',
    '"check:suggested-trades-health"',
    '"release-gate:suggested-trades"',
    '"signoff:suggested-trades"',
  ]) {
    if (!packageSource.includes(marker)) {
      findings.push(`package.json: missing release workflow script ${marker}`);
    }
  }

  const userScopedSchedulerServices = [
    'FundsSchedulerService.ts',
    'SignalsSchedulerService.ts',
    'RiskSchedulerService.ts',
    'OrdersSchedulerService.ts',
    'PositionsSchedulerService.ts',
  ];
  for (const fileName of userScopedSchedulerServices) {
    const filePath = path.join(servicesDir, fileName);
    const source = fs.readFileSync(filePath, 'utf8');
    if (!source.includes('findRecentOpenAlertBySource')) {
      findings.push(`${fileName}: missing scheduler failure alert throttle lookup`);
    }
    if (!source.includes('failureAlertThrottleMinutes')) {
      findings.push(`${fileName}: missing scheduler failure throttle window usage`);
    }
    if (!source.includes('findLatestBySchedulerKeyAndTypeAndActorInStatuses')) {
      findings.push(`${fileName}: missing actor-scoped pending command dedupe`);
    }
    if (!source.includes('hasRunningRunBySchedulerKeyAndActor')) {
      findings.push(`${fileName}: missing actor-scoped running dedupe`);
    }
  }

  const globalSystemSchedulerServices = [
    'SchedulerService.ts',
    'AssetPriceSchedulerService.ts',
    'BinanceAssetsSchedulerService.ts',
    'CandlesSchedulerService.ts',
    'HealthCheckSchedulerService.ts',
  ];
  for (const fileName of globalSystemSchedulerServices) {
    const filePath = path.join(servicesDir, fileName);
    const source = fs.readFileSync(filePath, 'utf8');
    if (!source.includes('findRecentOpenAlertBySource')) {
      findings.push(`${fileName}: missing scheduler failure alert throttle lookup`);
    }
    if (!source.includes('failureAlertThrottleMinutes')) {
      findings.push(`${fileName}: missing scheduler failure throttle window usage`);
    }
    if (!source.includes('cannot be switched to user scope')) {
      findings.push(`${fileName}: global system scheduler must reject attempts to switch into user scope`);
    }
    if (source.includes('findLatestBySchedulerKeyAndTypeAndActorInStatuses')) {
      findings.push(`${fileName}: global system scheduler must not use actor-scoped pending command dedupe`);
    }
    if (source.includes('hasRunningRunBySchedulerKeyAndActor')) {
      findings.push(`${fileName}: global system scheduler must not use actor-scoped running dedupe`);
    }
    if (source.includes("config.schedulerType === 'user'")) {
      findings.push(`${fileName}: global system scheduler must not branch between user and global ownership`);
    }
  }

  const sharedSchedulerServices = [
    'SchedulerService.ts',
    'AssetPriceSchedulerService.ts',
    'BinanceAssetsSchedulerService.ts',
    'CandlesSchedulerService.ts',
    'FundsSchedulerService.ts',
    'HealthCheckSchedulerService.ts',
    'OrdersSchedulerService.ts',
    'PositionsSchedulerService.ts',
    'RiskSchedulerService.ts',
  ];
  for (const fileName of sharedSchedulerServices) {
    const filePath = path.join(servicesDir, fileName);
    const source = fs.readFileSync(filePath, 'utf8');
    if (source.includes('timezone: timeZone,')) {
      findings.push(`${fileName}: shared scheduler must not persist user settings timezone`);
    }
    if (source.includes('normalizeTimeZone(timeZone')) {
      findings.push(`${fileName}: shared scheduler must not seed config timezone from user settings`);
    }
  }

  const positionsSchedulerSource = fs.readFileSync(
    path.join(servicesDir, 'PositionsSchedulerService.ts'),
    'utf8'
  );
  if (
    !positionsSchedulerSource.includes('is a user scheduler and cannot be switched to global scope')
  ) {
    findings.push(
      'PositionsSchedulerService.ts: positions scheduler must reject attempts to switch into global scope'
    );
  }
  if (positionsSchedulerSource.includes("config.schedulerType === 'user'")) {
    findings.push(
      'PositionsSchedulerService.ts: positions scheduler must not branch between user and global ownership'
    );
  }
  if (!positionsSchedulerSource.includes('ownerUserId')) {
    findings.push(
      'PositionsSchedulerService.ts: positions scheduler sync-state should expose ownerUserId diagnostics semantics'
    );
  }
  if (positionsSchedulerSource.includes('query.userId')) {
    findings.push(
      'PositionsSchedulerService.ts: positions scheduler sync-state should not keep the legacy userId query alias'
    );
  }
  if (!positionsSchedulerSource.includes('Positions scheduler run not found')) {
    findings.push(
      'PositionsSchedulerService.ts: positions scheduler run updates must validate that the run belongs to positions-sync'
    );
  }
  if (!positionsSchedulerSource.includes("action: 'rebuild_read_model'")) {
    findings.push(
      'PositionsSchedulerService.ts: positions scheduler should expose a first-class read-model rebuild action contract'
    );
  }
  if (!positionsSchedulerSource.includes('readModelRecoveryPolicy')) {
    findings.push(
      'PositionsSchedulerService.ts: positions scheduler config should expose read-model recovery policy metadata'
    );
  }
  if (!positionsSchedulerSource.includes('POSITIONS_SCHEDULER_PRODUCT_SPLIT_PHASE6.md')) {
    findings.push(
      'PositionsSchedulerService.ts: positions scheduler recovery policy should publish the Phase 6 runbook path'
    );
  }
  if (!positionsSchedulerSource.includes('listReadModelRecoveryHistory')) {
    findings.push(
      'PositionsSchedulerService.ts: positions scheduler should expose a persisted read-model recovery history surface'
    );
  }
  if (!positionsSchedulerSource.includes('positions-read-model-recovery')) {
    findings.push(
      'PositionsSchedulerService.ts: positions scheduler recovery history should be backed by a dedicated persisted activity reference'
    );
  }

  const riskSchedulerSource = fs.readFileSync(
    path.join(servicesDir, 'RiskSchedulerService.ts'),
    'utf8'
  );
  if (
    !riskSchedulerSource.includes(
      'Risk Snapshot Refresh is a user scheduler and cannot be switched to global scope.'
    )
  ) {
    findings.push(
      'RiskSchedulerService.ts: risk scheduler must reject attempts to switch into global scope'
    );
  }
  if (!riskSchedulerSource.includes('findLatestBySchedulerKeyAndTypeAndActorInStatuses')) {
    findings.push(
      'RiskSchedulerService.ts: risk scheduler must use actor-scoped pending command dedupe'
    );
  }
  if (!riskSchedulerSource.includes('hasRunningRunBySchedulerKeyAndActor')) {
    findings.push(
      'RiskSchedulerService.ts: risk scheduler must use actor-scoped running dedupe'
    );
  }
  if (!riskSchedulerSource.includes('getSchedulerDiagnosticsSummary')) {
    findings.push(
      'RiskSchedulerService.ts: risk scheduler should expose a dedicated diagnostics summary for admin ops'
    );
  }

  const expressLoaderSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'loaders', 'ExpressLoader.ts'),
    'utf8'
  );
  if (expressLoaderSource.includes('/scheduler/positions-sync')) {
    findings.push(
      'ExpressLoader.ts: deprecated /scheduler/positions-sync alias should be retired once positions scheduler canonical route is stable'
    );
  }

  const controllersDir = path.join(process.cwd(), 'src', 'api', 'controllers');
  const schedulerControllers = [
    'SchedulerController.ts',
    'CandlesSchedulerController.ts',
    'FundsSchedulerController.ts',
    'RiskSchedulerController.ts',
  ];
  for (const fileName of schedulerControllers) {
    const source = fs.readFileSync(path.join(controllersDir, fileName), 'utf8');
    const requiredRoutes = [
      "@Post('/run')",
      "@Post('/pause')",
      "@Post('/resume')",
      "@Post('/stop')",
      "@Post('/restart')",
      "@Get('/runs')",
      "@Get('/runs/:runId/progress')",
    ];
    for (const routeMarker of requiredRoutes) {
      if (!source.includes(routeMarker)) {
        findings.push(`${fileName}: missing required scheduler route ${routeMarker}`);
      }
    }
  }

  const riskSchedulerControllerSource = fs.readFileSync(
    path.join(controllersDir, 'RiskSchedulerController.ts'),
    'utf8'
  );
  if (!riskSchedulerControllerSource.includes("@Get('/summary')")) {
    findings.push(
      "RiskSchedulerController.ts: missing required admin diagnostics route @Get('/summary')"
    );
  }

  const fundsSchedulerControllerSource = fs.readFileSync(
    path.join(controllersDir, 'FundsSchedulerController.ts'),
    'utf8'
  );
  for (const routeMarker of ["@Get('/summary')", "@Get('/coverage')", "@Get('/purge-logs/preview')"]) {
    if (!fundsSchedulerControllerSource.includes(routeMarker)) {
      findings.push(
        `FundsSchedulerController.ts: missing required admin diagnostics route ${routeMarker}`
      );
    }
  }

  const internalFundsSchedulerControllerSource = fs.readFileSync(
    path.join(controllersDir, 'InternalFundsSchedulerController.ts'),
    'utf8'
  );
  if (!internalFundsSchedulerControllerSource.includes("@Post('/snapshot')")) {
    findings.push(
      "InternalFundsSchedulerController.ts: missing required internal funds snapshot route @Post('/snapshot')"
    );
  }

  const healthControllerSource = fs.readFileSync(
    path.join(controllersDir, 'HealthController.ts'),
    'utf8'
  );
  for (const marker of [
    "@Get('/suggested-trades')",
    'suggestedTradesHealthService',
    "@Get('/broker-canary')",
    'brokerCanaryProtectionMonitorService',
    "@Get('/suggested-trades-protection-guardrails')",
    'suggestedTradesProtectionGuardrailService',
  ]) {
    if (!healthControllerSource.includes(marker)) {
      findings.push(`HealthController.ts: missing operational health marker ${marker}`);
    }
  }

  const alertEntityPath = path.join(process.cwd(), 'src', 'database', 'entities', 'Alert.ts');
  const alertEntitySource = fs.readFileSync(alertEntityPath, 'utf8');
  for (const indexName of [
    'idx_alerts_user_created_at',
    'idx_alerts_user_status_created_at',
    'idx_alerts_user_severity_created_at',
  ]) {
    if (!alertEntitySource.includes(`@Index('${indexName}'`)) {
      findings.push(`Alert.ts: missing required alerts inbox entity index ${indexName}`);
    }
  }

  const alertsIndexSchemaPath = [
    path.join(
      process.cwd(),
      'src',
      'database',
      'migrations',
      '1765602000000-AddAlertsInboxIndexes.ts'
    ),
    path.join(
      process.cwd(),
      'src',
      'database',
      'migrations_baseline',
      '1800000000000-BaselineCoreSchema.ts'
    ),
  ].find((candidatePath) => fs.existsSync(candidatePath));
  if (!alertsIndexSchemaPath) {
    findings.push('alerts schema: missing alerts inbox index migration or baseline schema file');
  }
  const alertsIndexMigrationSource = alertsIndexSchemaPath
    ? fs.readFileSync(alertsIndexSchemaPath, 'utf8')
    : '';
  for (const indexName of [
    'idx_alerts_user_created_at',
    'idx_alerts_user_status_created_at',
    'idx_alerts_user_severity_created_at',
  ]) {
    if (!alertsIndexMigrationSource.includes(indexName)) {
      findings.push(
        `1765602000000-AddAlertsInboxIndexes.ts: missing alerts inbox migration index ${indexName}`
      );
    }
  }

  const alertContractPath = path.join(process.cwd(), 'src', 'api', 'contracts', 'Alert.ts');
  const alertContractSource = fs.readFileSync(alertContractPath, 'utf8');
  if (!alertContractSource.includes('highSeverityAlerts: number;')) {
    findings.push('Alert.ts: alerts summary contract must expose highSeverityAlerts');
  }

  const strategyTemplateEntityPath = path.join(
    process.cwd(),
    'src',
    'database',
    'entities',
    'StrategyTemplate.ts'
  );
  const strategyTemplateEntitySource = fs.readFileSync(strategyTemplateEntityPath, 'utf8');
  if (!strategyTemplateEntitySource.includes("@Index('uidx_strategy_templates_user_id_id'")) {
    findings.push('StrategyTemplate.ts: missing composite ownership index uidx_strategy_templates_user_id_id');
  }

  const strategyLibraryIntegritySchemaPath = [
    path.join(
      process.cwd(),
      'src',
      'database',
      'pg-migrations',
      '1767300007000-HardenStrategyLibraryIntegrityPg.ts'
    ),
    path.join(
      process.cwd(),
      'src',
      'database',
      'pg-migrations_baseline',
      '1800000000000-BaselineStrategySchema.ts'
    ),
  ].find((candidatePath) => fs.existsSync(candidatePath));
  if (!strategyLibraryIntegritySchemaPath) {
    findings.push(
      'strategy library schema: missing hardening migration or baseline schema file'
    );
  }
  const strategyLibraryIntegrityMigrationSource = strategyLibraryIntegritySchemaPath
    ? fs.readFileSync(strategyLibraryIntegritySchemaPath, 'utf8')
    : '';
  for (const marker of [
    'uidx_strategy_library_user_template_name_ci',
    'fk_strategy_library_user_template_owner',
    'chk_strategy_library_name_not_blank',
    'chk_strategy_library_status_valid',
    'chk_strategy_library_assets_array',
    'chk_strategy_library_timeframes_array',
    'chk_strategy_library_overrides_object',
  ]) {
    if (!strategyLibraryIntegrityMigrationSource.includes(marker)) {
      findings.push(
        `strategy library schema: missing strategy-library integrity marker ${marker}`
      );
    }
  }

  assert.equal(findings.length, 0, `Operational coverage audit failed:\n${findings.join('\n')}`);
}

runOperationalAudit();
console.log('Operational coverage audit passed.');
