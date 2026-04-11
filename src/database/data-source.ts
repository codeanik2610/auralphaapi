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
import { Exchange } from './entities/Exchange';
import { EmailDelivery } from './entities/EmailDelivery';
import { Connection } from './entities/Connection';
import { AppSetting } from './entities/AppSetting';
import { PortfolioHolding } from './entities/PortfolioHolding';
import { RiskPolicy } from './entities/RiskPolicy';
import { RiskPolicyVersion } from './entities/RiskPolicyVersion';
import { RiskSnapshot } from './entities/RiskSnapshot';
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
  entities: [Trade, ActivityExport, ActivityLog, ActivitySavedView, Alert, AlertAction, AssetPrice, Asset, ExchangeAsset, ExchangeAssetUpdateLog, MarketSymbolSnapshot, Signal, SignalAction, SignalAlertLink, SuggestedTrade, SuggestedTradeExecution, Automation, AutomationCursor, AutomationEvent, AutomationAlert, AutomationRun, AutomationRunOutput, Watchlist, WatchlistItem, Connection, BrokerAccount, Broker, Exchange, EmailDelivery, AppSetting, SettingsAuditLog, SchedulerConfig, SchedulerCommand, SchedulerRunLog, SchedulerUserConfig, PortfolioSnapshot, PortfolioHolding, PaperOrder, OrderSubmissionRequest, RiskSnapshot, RiskPolicy, RiskPolicyVersion, User, RefreshToken],
  migrations: [`${__dirname}/migrations/*.{ts,js}`],
});
