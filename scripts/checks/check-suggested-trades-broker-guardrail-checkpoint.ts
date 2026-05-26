import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

type JsonRecord = Record<string, unknown>;

type GuardrailArtifactKey =
  | 'candidateAlerts'
  | 'mudrexPositionResolution'
  | 'mudrexProtectionGuardrail'
  | 'mudrexStaleProtectionWatchdog'
  | 'deltaPositionResolution'
  | 'deltaProtectionGuardrail'
  | 'deltaStaleProtectionWatchdog';

type GuardrailArtifactConfig = {
  key: GuardrailArtifactKey;
  dirName: string;
  required: boolean;
};

type LatestGuardrailArtifact = {
  key: GuardrailArtifactKey;
  dirName: string;
  required: boolean;
  path: string | null;
  generatedAt: string | null;
  fileMtime: string | null;
  ageMinutes: number | null;
  stale: boolean;
  missing: boolean;
  error: string | null;
  summary: JsonRecord;
};

const OUTPUT_PREFIX = 'suggested-trades-broker-guardrail-checkpoint:';
const DEFAULT_ARTIFACT_ROOT = '/opt/auralpha/guardrail-artifacts';
const DEFAULT_OUTPUT_FILE = 'artifacts/suggested-trades-broker-guardrail-checkpoint.json';
const DEFAULT_MAX_ARTIFACT_AGE_MINUTES = 180;

const ARTIFACT_ROOT = String(
  process.env.AURALPHA_GUARDRAIL_ARTIFACT_ROOT || DEFAULT_ARTIFACT_ROOT
).trim();
const OUTPUT_FILE = String(
  process.env.SUGGESTED_TRADES_BROKER_GUARDRAIL_CHECKPOINT_OUTPUT_FILE || DEFAULT_OUTPUT_FILE
).trim();
const MAX_ARTIFACT_AGE_MINUTES = readNonNegativeIntegerEnv(
  'SUGGESTED_TRADES_BROKER_GUARDRAIL_CHECKPOINT_MAX_ARTIFACT_AGE_MINUTES',
  DEFAULT_MAX_ARTIFACT_AGE_MINUTES
);

const ARTIFACTS: GuardrailArtifactConfig[] = [
  {
    key: 'candidateAlerts',
    dirName: 'broker-guardrail-candidate-alerts',
    required: true,
  },
  {
    key: 'mudrexPositionResolution',
    dirName: 'mudrex-position-resolution',
    required: true,
  },
  {
    key: 'mudrexProtectionGuardrail',
    dirName: 'mudrex-protection-guardrail',
    required: true,
  },
  {
    key: 'mudrexStaleProtectionWatchdog',
    dirName: 'mudrex-stale-protection-watchdog',
    required: true,
  },
  {
    key: 'deltaPositionResolution',
    dirName: 'delta-position-resolution',
    required: true,
  },
  {
    key: 'deltaProtectionGuardrail',
    dirName: 'delta-protection-guardrail',
    required: true,
  },
  {
    key: 'deltaStaleProtectionWatchdog',
    dirName: 'delta-stale-protection-watchdog',
    required: true,
  },
];

function readNonNegativeIntegerEnv(name: string, defaultValue: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value < 0) {
    return defaultValue;
  }
  return Math.trunc(value);
}

function readRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readObjectValue(record: JsonRecord, key: string): JsonRecord {
  return readRecord(record[key]);
}

function readDateMillis(value: unknown): number | null {
  const text = readString(value);
  if (!text) {
    return null;
  }
  const millis = Date.parse(text);
  return Number.isFinite(millis) ? millis : null;
}

function summarizeArtifact(key: GuardrailArtifactKey, data: JsonRecord): JsonRecord {
  switch (key) {
    case 'candidateAlerts':
      return {
        dryRun: readBoolean(data.dryRun),
        candidateItems: readNumber(data.candidateItems),
        emittedAlerts: readNumber(data.emittedAlerts),
        byBroker: readObjectValue(data, 'byBroker'),
        previewSummary: readObjectValue(data, 'previewSummary'),
      };
    case 'mudrexPositionResolution':
      return {
        audited: readNumber(data.audited),
        exactReadModel: readNumber(data.exactReadModel),
        unresolvedPreferred: readNumber(data.unresolvedPreferred),
        unsafeMismatch: readNumber(data.unsafeMismatch),
        byType: readObjectValue(data, 'byType'),
      };
    case 'deltaPositionResolution':
      return {
        audited: readNumber(data.audited),
        exactReadModel: readNumber(data.exactReadModel),
        unresolved: readNumber(data.unresolved),
        unsafeMismatch: readNumber(data.unsafeMismatch),
        byType: readObjectValue(data, 'byType'),
      };
    case 'mudrexProtectionGuardrail':
    case 'deltaProtectionGuardrail':
      return {
        audited: readNumber(data.audited),
        openPositions: readNumber(data.openPositions),
        issueTrades: readNumber(data.issueTrades),
        missingPositionReadModel: readNumber(data.missingPositionReadModel),
        missingActiveStopLoss: readNumber(data.missingActiveStopLoss),
        missingActiveTakeProfit: readNumber(data.missingActiveTakeProfit),
        staleProtectionForClosedPosition: readNumber(data.staleProtectionForClosedPosition),
        partialFillProtectionMismatch: readNumber(data.partialFillProtectionMismatch),
        unsafePositionMismatch: readNumber(data.unsafePositionMismatch),
      };
    case 'mudrexStaleProtectionWatchdog':
    case 'deltaStaleProtectionWatchdog':
      return {
        dryRun: readBoolean(data.dryRun),
        mutation: readString(data.mutation),
        applyEnabled: readBoolean(data.applyEnabled),
        staleCancelApplyEnabled: readBoolean(data.staleCancelApplyEnabled),
        applyFlagsSafe: readBoolean(data.applyFlagsSafe),
        staleCancelCandidateItems: readNumber(data.staleCancelCandidateItems),
        stalePreviewItems: readNumber(data.stalePreviewItems),
        preview: readObjectValue(data, 'preview'),
      };
  }
}

function sumNumbers(values: unknown[]): number {
  return values.reduce<number>((total, value) => total + readNumber(value), 0);
}

async function readLatestArtifact(
  config: GuardrailArtifactConfig,
  nowMillis: number
): Promise<LatestGuardrailArtifact> {
  const dirPath = path.join(ARTIFACT_ROOT, config.dirName);

  try {
    const entries = await readdir(dirPath);
    const jsonEntries = entries.filter((entry) => entry.endsWith('.json'));

    if (jsonEntries.length === 0) {
      return {
        ...config,
        path: null,
        generatedAt: null,
        fileMtime: null,
        ageMinutes: null,
        stale: false,
        missing: true,
        error: 'no_json_artifacts',
        summary: {},
      };
    }

    const candidates = await Promise.all(
      jsonEntries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry);
        const metadata = await stat(fullPath);
        return {
          fullPath,
          mtimeMs: metadata.mtimeMs,
          fileMtime: metadata.mtime.toISOString(),
        };
      })
    );
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);

    const latest = candidates[0];
    const raw = await readFile(latest.fullPath, 'utf8');
    const parsed = readRecord(JSON.parse(raw));
    const generatedAt = readString(parsed.generatedAt);
    const ageBaseMillis = readDateMillis(generatedAt) ?? latest.mtimeMs;
    const ageMinutes = Math.max(0, Math.round((nowMillis - ageBaseMillis) / 60000));

    return {
      ...config,
      path: latest.fullPath,
      generatedAt,
      fileMtime: latest.fileMtime,
      ageMinutes,
      stale: ageMinutes > MAX_ARTIFACT_AGE_MINUTES,
      missing: false,
      error: null,
      summary: summarizeArtifact(config.key, parsed),
    };
  } catch (error) {
    return {
      ...config,
      path: null,
      generatedAt: null,
      fileMtime: null,
      ageMinutes: null,
      stale: false,
      missing: true,
      error: error instanceof Error ? error.message : String(error),
      summary: {},
    };
  }
}

async function persistReport(report: JsonRecord): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }
  const absoluteOutputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function buildBrokerSummary(artifacts: Record<GuardrailArtifactKey, LatestGuardrailArtifact>) {
  const mudrexPosition = artifacts.mudrexPositionResolution.summary;
  const mudrexProtection = artifacts.mudrexProtectionGuardrail.summary;
  const mudrexStale = artifacts.mudrexStaleProtectionWatchdog.summary;
  const deltaPosition = artifacts.deltaPositionResolution.summary;
  const deltaProtection = artifacts.deltaProtectionGuardrail.summary;
  const deltaStale = artifacts.deltaStaleProtectionWatchdog.summary;

  return {
    mudrex: {
      audited: {
        positionResolution: readNumber(mudrexPosition.audited),
        protectionGuardrail: readNumber(mudrexProtection.audited),
      },
      openPositions: readNumber(mudrexProtection.openPositions),
      issues: {
        unresolvedPosition: readNumber(mudrexPosition.unresolvedPreferred),
        unsafePosition: readNumber(mudrexPosition.unsafeMismatch),
        protectionIssueTrades: readNumber(mudrexProtection.issueTrades),
        missingStopLoss: readNumber(mudrexProtection.missingActiveStopLoss),
        missingTakeProfit: readNumber(mudrexProtection.missingActiveTakeProfit),
        staleProtection: readNumber(mudrexProtection.staleProtectionForClosedPosition),
        partialFillMismatch: readNumber(mudrexProtection.partialFillProtectionMismatch),
        staleCancelCandidates: readNumber(mudrexStale.staleCancelCandidateItems),
      },
      applyFlagsSafe: readBoolean(mudrexStale.applyFlagsSafe),
    },
    delta: {
      audited: {
        positionResolution: readNumber(deltaPosition.audited),
        protectionGuardrail: readNumber(deltaProtection.audited),
      },
      openPositions: readNumber(deltaProtection.openPositions),
      issues: {
        unresolvedPosition: readNumber(deltaPosition.unresolved),
        unsafePosition: readNumber(deltaPosition.unsafeMismatch),
        protectionIssueTrades: readNumber(deltaProtection.issueTrades),
        missingStopLoss: readNumber(deltaProtection.missingActiveStopLoss),
        missingTakeProfit: readNumber(deltaProtection.missingActiveTakeProfit),
        staleProtection: readNumber(deltaProtection.staleProtectionForClosedPosition),
        partialFillMismatch: readNumber(deltaProtection.partialFillProtectionMismatch),
        staleCancelCandidates: readNumber(deltaStale.staleCancelCandidateItems),
      },
      applyFlagsSafe: readBoolean(deltaStale.applyFlagsSafe),
    },
  };
}

async function run(): Promise<void> {
  const now = new Date();
  const latestArtifacts = await Promise.all(
    ARTIFACTS.map((artifact) => readLatestArtifact(artifact, now.getTime()))
  );
  const artifactsByKey = Object.fromEntries(
    latestArtifacts.map((artifact) => [artifact.key, artifact])
  ) as Record<GuardrailArtifactKey, LatestGuardrailArtifact>;
  const brokerSummary = buildBrokerSummary(artifactsByKey);
  const candidateSummary = artifactsByKey.candidateAlerts.summary;

  const missingRequiredArtifacts = latestArtifacts.filter(
    (artifact) => artifact.required && artifact.missing
  );
  const staleArtifacts = latestArtifacts.filter((artifact) => artifact.stale);
  const candidateItems = readNumber(candidateSummary.candidateItems);
  const emittedAlerts = readNumber(candidateSummary.emittedAlerts);
  const applyFlagsSafe = brokerSummary.mudrex.applyFlagsSafe && brokerSummary.delta.applyFlagsSafe;
  const brokerIssueCount = sumNumbers([
    ...Object.values(brokerSummary.mudrex.issues),
    ...Object.values(brokerSummary.delta.issues),
  ]);
  const phase1Ready = candidateItems > 0;
  const passed =
    missingRequiredArtifacts.length === 0 && staleArtifacts.length === 0 && applyFlagsSafe;

  const report = {
    generatedAt: now.toISOString(),
    mode: 'read_only_checkpoint',
    artifactRoot: ARTIFACT_ROOT,
    maxArtifactAgeMinutes: MAX_ARTIFACT_AGE_MINUTES,
    status: phase1Ready ? 'candidate_ready' : 'observe_only',
    phase1Ready,
    phase1Reason: phase1Ready
      ? `${candidateItems} broker guardrail candidate(s) need review before canary apply.`
      : 'No repairable broker guardrail candidates are waiting for canary apply.',
    passed,
    applyFlagsSafe,
    brokerIssueCount,
    candidateItems,
    emittedAlerts,
    missingRequiredArtifacts: missingRequiredArtifacts.map((artifact) => artifact.dirName),
    staleArtifacts: staleArtifacts.map((artifact) => ({
      dirName: artifact.dirName,
      ageMinutes: artifact.ageMinutes,
      generatedAt: artifact.generatedAt,
      path: artifact.path,
    })),
    brokerSummary,
    candidateSummary,
    artifacts: latestArtifacts,
  };

  await persistReport(report);
  console.log(OUTPUT_PREFIX, JSON.stringify(report));

  if (!passed) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error('suggested-trades-broker-guardrail-checkpoint failed:', error);
  process.exitCode = 1;
});
