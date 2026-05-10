import { env } from '../../../env';
import {
  isDeltaExchangeSuggestedTradeBroker,
  resolveDeltaExchangeSuggestedTradeLiveAutoEnabled,
  resolveDeltaExchangeSuggestedTradeProtectionRepairEnabled,
} from './DeltaExchangeSuggestedTradeBroker';
import {
  isMudrexSuggestedTradeBroker,
  resolveMudrexSuggestedTradeLiveAutoEnabled,
  resolveMudrexSuggestedTradeProtectionRepairEnabled,
} from './MudrexSuggestedTradeBroker';

export type LiveAutoAdaptiveRoutingMode = 'off' | 'shadow' | 'live';

export interface LiveAutoRuntimeConfig {
  rolloutEnabled: boolean;
  enabled: boolean;
  executionEnabled: boolean;
  mudrexEnabled: boolean;
  deltaExchangeEnabled: boolean;
  adaptiveRoutingMode: LiveAutoAdaptiveRoutingMode;
  requireFixedRouting: boolean;
  userAllowlist: string[];
  brokerAllowlist: string[];
  shadowBrokerAllowlist: string[];
}

type BooleanEnvReader = (name: string) => boolean | null;
type StringEnvReader = (name: string) => string | null;
type ArrayEnvReader = (name: string) => string[] | null;

interface ResolveLiveAutoRuntimeConfigInput {
  readBooleanEnvOverride: BooleanEnvReader;
  readStringEnvOverride: StringEnvReader;
  readArrayEnvOverride: ArrayEnvReader;
}

export function resolveLiveAutoAdaptiveRoutingModeValue(
  value: unknown
): LiveAutoAdaptiveRoutingMode {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized || normalized === 'live') {
    return 'live';
  }
  if (normalized === 'shadow' || normalized === 'off') {
    return normalized;
  }

  return 'live';
}

export function resolveSuggestedTradeLiveAutoRuntimeConfig(
  input: ResolveLiveAutoRuntimeConfigInput
): LiveAutoRuntimeConfig {
  const rolloutEnabled =
    input.readBooleanEnvOverride('SUGGESTED_TRADES_ROLLOUT_ENABLED') ??
    env.suggestedTrades.rolloutEnabled;
  const enabled =
    input.readBooleanEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_ENABLED') ??
    env.suggestedTrades.liveAuto.enabled;
  const executionEnabled =
    input.readBooleanEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED') ??
    env.suggestedTrades.liveAuto.executionEnabled;
  const mudrexEnabled = resolveMudrexSuggestedTradeLiveAutoEnabled(
    enabled,
    input.readBooleanEnvOverride
  );
  const deltaExchangeEnabled = resolveDeltaExchangeSuggestedTradeLiveAutoEnabled(
    enabled,
    input.readBooleanEnvOverride
  );
  const adaptiveRoutingMode = resolveLiveAutoAdaptiveRoutingModeValue(
    input.readStringEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_ADAPTIVE_ROUTING_MODE') ??
      env.suggestedTrades.liveAuto.adaptiveRoutingMode
  );
  const requireFixedRouting =
    input.readBooleanEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING') ??
    env.suggestedTrades.liveAuto.requireFixedRouting;
  const userAllowlist =
    input.readArrayEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST') ??
    env.suggestedTrades.liveAuto.userAllowlist;
  const brokerAllowlist =
    input.readArrayEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST') ??
    env.suggestedTrades.liveAuto.brokerAllowlist;
  const shadowBrokerAllowlist =
    input.readArrayEnvOverride('SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST') ??
    env.suggestedTrades.liveAuto.shadowBrokerAllowlist ??
    [];

  return {
    rolloutEnabled,
    enabled,
    executionEnabled,
    mudrexEnabled,
    deltaExchangeEnabled,
    adaptiveRoutingMode,
    requireFixedRouting,
    userAllowlist: userAllowlist.map((item) => String(item).trim()).filter(Boolean),
    brokerAllowlist: brokerAllowlist
      .map((item) => String(item).trim().toLowerCase())
      .filter(Boolean),
    shadowBrokerAllowlist: Array.from(
      new Set(
        shadowBrokerAllowlist.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
      )
    ),
  };
}

export function isSuggestedTradeLiveAutoBrokerEnabled(
  liveAutoConfig: LiveAutoRuntimeConfig,
  brokerKey: string | null | undefined
): boolean {
  const normalizedBrokerKey = String(brokerKey || '')
    .trim()
    .toLowerCase();
  if (isMudrexSuggestedTradeBroker(normalizedBrokerKey)) {
    return liveAutoConfig.mudrexEnabled !== false;
  }
  if (isDeltaExchangeSuggestedTradeBroker(normalizedBrokerKey)) {
    return liveAutoConfig.deltaExchangeEnabled !== false;
  }
  return true;
}

export function isSuggestedTradeProtectionRepairEnabledForBroker(
  brokerKey: string | null | undefined,
  readBooleanEnvOverride: BooleanEnvReader
): boolean {
  const normalizedBrokerKey = String(brokerKey || '')
    .trim()
    .toLowerCase();
  if (isMudrexSuggestedTradeBroker(normalizedBrokerKey)) {
    return resolveMudrexSuggestedTradeProtectionRepairEnabled(readBooleanEnvOverride);
  }
  if (isDeltaExchangeSuggestedTradeBroker(normalizedBrokerKey)) {
    return resolveDeltaExchangeSuggestedTradeProtectionRepairEnabled(readBooleanEnvOverride);
  }
  return true;
}
