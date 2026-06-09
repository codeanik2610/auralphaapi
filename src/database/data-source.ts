import { DataSource } from 'typeorm';
import { env } from '../env';
import { ActivityExport } from './entities/ActivityExport';
import { ActivityLog } from './entities/ActivityLog';
import { ActivitySavedView } from './entities/ActivitySavedView';
import { Alert } from './entities/Alert';
import { AlertAction } from './entities/AlertAction';
import { AssetPrice } from './entities/AssetPrice';
import { Asset } from './entities/Asset';
import { BrokerAccount } from './entities/BrokerAccount';
import { Broker } from './entities/Broker';
import { BrokerBalanceSnapshot } from './entities/BrokerBalanceSnapshot';
import { BrokerFeeEntry } from './entities/BrokerFeeEntry';
import { BrokerFill } from './entities/BrokerFill';
import { BrokerFundingEntry } from './entities/BrokerFundingEntry';
import { BrokerReconciliationRun } from './entities/BrokerReconciliationRun';
import { BrokerWalletTransaction } from './entities/BrokerWalletTransaction';
import { Exchange } from './entities/Exchange';
import { EmailDelivery } from './entities/EmailDelivery';
import { WhatsappDelivery } from './entities/WhatsappDelivery';
import { Connection } from './entities/Connection';
import { AppSetting } from './entities/AppSetting';
import { PortfolioHolding } from './entities/PortfolioHolding';
import { RiskPolicy } from './entities/RiskPolicy';
import { RiskPolicyVersion } from './entities/RiskPolicyVersion';
import { RiskKillSwitchState } from './entities/RiskKillSwitchState';
import { RiskAccountSnapshot } from './entities/RiskAccountSnapshot';
import { RiskAssetSnapshot } from './entities/RiskAssetSnapshot';
import { RiskBrokerAssetSnapshot } from './entities/RiskBrokerAssetSnapshot';
import { RiskBrokerSnapshot } from './entities/RiskBrokerSnapshot';
import { RiskOrderSnapshot } from './entities/RiskOrderSnapshot';
import { RiskPositionSnapshot } from './entities/RiskPositionSnapshot';
import { RiskRequestCheck } from './entities/RiskRequestCheck';
import { RiskRequestRuleEvaluation } from './entities/RiskRequestRuleEvaluation';
import { RiskRequestScopeImpact } from './entities/RiskRequestScopeImpact';
import { RiskRuleEvaluation } from './entities/RiskRuleEvaluation';
import { RiskSnapshot } from './entities/RiskSnapshot';
import { RiskSnapshotPolicyContext } from './entities/RiskSnapshotPolicyContext';
import { RiskSnapshotSourceCoverage } from './entities/RiskSnapshotSourceCoverage';
import { RefreshToken } from './entities/RefreshToken';
import { User } from './entities/User';
import { PortfolioSnapshot } from './entities/PortfolioSnapshot';
import { Automation } from './entities/Automation';
import { AutomationCursor } from './entities/AutomationCursor';
import { AutomationAlert } from './entities/AutomationAlert';
import { AutomationEvent } from './entities/AutomationEvent';
import { AutomationRun } from './entities/AutomationRun';
import { AutomationRunOutput } from './entities/AutomationRunOutput';
import { ExchangeAsset } from './entities/ExchangeAsset';
import { Signal } from './entities/Signal';
import { SignalAction } from './entities/SignalAction';
import { SignalAlertLink } from './entities/SignalAlertLink';
import { SuggestedTrade } from './entities/SuggestedTrade';
import { SuggestedTradeExecution } from './entities/SuggestedTradeExecution';
import { SettingsAuditLog } from './entities/SettingsAuditLog';
import { Trade } from './entities/Trade';
import { Watchlist } from './entities/Watchlist';
import { WatchlistItem } from './entities/WatchlistItem';
import { SchedulerConfig } from './entities/SchedulerConfig';
import { SchedulerRunLog } from './entities/SchedulerRunLog';
import { SchedulerUserConfig } from './entities/SchedulerUserConfig';
import { ExchangeAssetUpdateLog } from './entities/ExchangeAssetUpdateLog';
import { SchedulerHealthCheckResult } from './entities/SchedulerHealthCheckResult';
import { SchedulerCommand } from './entities/SchedulerCommand';
import { MarketSymbolSnapshot } from './entities/MarketSymbolSnapshot';
import { OrderSubmissionRequest } from './entities/OrderSubmissionRequest';
import { PaperOrder } from './entities/PaperOrder';

export const coreDataSource = new DataSource({
  type: 'mysql',
  host: env.db.host,
  port: env.db.port,
  username: env.db.username,
  password: env.db.password,
  database: env.db.database,
  timezone: 'Z',
  synchronize: env.db.synchronize,
  logging: env.db.logging,
  entities: [
    Trade,
    ActivityExport,
    ActivityLog,
    ActivitySavedView,
    Alert,
    AlertAction,
    AssetPrice,
    Asset,
    ExchangeAsset,
    ExchangeAssetUpdateLog,
    SchedulerHealthCheckResult,
    MarketSymbolSnapshot,
    Signal,
    SignalAction,
    SignalAlertLink,
    SuggestedTrade,
    SuggestedTradeExecution,
    Automation,
    AutomationCursor,
    AutomationEvent,
    AutomationAlert,
    AutomationRun,
    AutomationRunOutput,
    Watchlist,
    WatchlistItem,
    Connection,
    BrokerAccount,
    Broker,
    BrokerBalanceSnapshot,
    BrokerFeeEntry,
    BrokerFill,
    BrokerFundingEntry,
    BrokerReconciliationRun,
    BrokerWalletTransaction,
    Exchange,
    EmailDelivery,
    WhatsappDelivery,
    AppSetting,
    SettingsAuditLog,
    SchedulerConfig,
    SchedulerCommand,
    SchedulerRunLog,
    SchedulerUserConfig,
    PortfolioSnapshot,
    PortfolioHolding,
    PaperOrder,
    OrderSubmissionRequest,
    RiskAccountSnapshot,
    RiskAssetSnapshot,
    RiskBrokerAssetSnapshot,
    RiskBrokerSnapshot,
    RiskOrderSnapshot,
    RiskPositionSnapshot,
    RiskRequestCheck,
    RiskRequestRuleEvaluation,
    RiskRequestScopeImpact,
    RiskRuleEvaluation,
    RiskSnapshot,
    RiskSnapshotPolicyContext,
    RiskSnapshotSourceCoverage,
    RiskPolicy,
    RiskPolicyVersion,
    RiskKillSwitchState,
    User,
    RefreshToken,
  ],
  migrations: [`${__dirname}/migrations_baseline/*.{ts,js}`],
});
