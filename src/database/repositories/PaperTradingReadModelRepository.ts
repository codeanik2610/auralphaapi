import { Service } from 'typedi';
import { QueryRunner } from 'typeorm';
import { coreDataSource } from '../data-source';

export interface PaperAccountReadModelRow {
  id: string;
  userId: string;
  brokerKey: string;
  linkedAccountId: string;
  accountName: string | null;
  accountKey: string | null;
  accountStatus: string | null;
  label: string | null;
  baseCurrency: string;
  startingBalance: number;
  cashBalance: number;
  equity: number;
  usedMargin: number;
  availableMargin: number;
  openPositions: number;
  closedPositions: number;
  realizedPnl: number;
  unrealizedPnl: number;
  observedAt: Date | null;
  resetAt?: Date | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface PaperPositionReadModelRow {
  id: string;
  userId: string;
  paperAccountId: string;
  paperOrderId: string;
  suggestedTradeId: string | null;
  brokerKey: string;
  linkedAccountId: string;
  accountName: string | null;
  accountKey: string | null;
  accountStatus: string | null;
  symbol: string;
  side: string;
  sideKey: string;
  status: string;
  statusKey: string;
  executionState: string | null;
  quantity: number;
  entryPrice: number | null;
  currentPrice: number | null;
  exitPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  leverage: number | null;
  liquidationPrice: number | null;
  exposure: number | null;
  unrealizedPnl: number | null;
  realizedPnl: number | null;
  outcome: string | null;
  closeReason: string | null;
  observationSource: string | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
  openedAt: Date | null;
  updatedAt: Date;
  closedAt: Date | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

export interface PaperPositionEventRow {
  id: string;
  userId: string;
  paperAccountId: string;
  paperPositionId: string | null;
  paperOrderId: string;
  brokerKey: string;
  linkedAccountId: string;
  symbol: string | null;
  side: string | null;
  eventType: string;
  price: number | null;
  quantity: number | null;
  realizedPnlDelta: number | null;
  equityAfter: number | null;
  occurredAt: Date;
  payload: Record<string, unknown> | null;
}

type PaperPositionListOptions = {
  brokerKey?: string;
  accountId?: string;
  statusKey?: string;
  startDate?: Date | null;
  endDate?: Date | null;
  symbol?: string;
  limit?: number;
  offset?: number;
};

@Service()
export class PaperTradingReadModelRepository {
  private storageReady = false;

  async ensureStorage(): Promise<void> {
    if (this.storageReady) {
      return;
    }

    await coreDataSource.query(`
      CREATE TABLE IF NOT EXISTS paper_accounts (
        id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        broker_key VARCHAR(100) NOT NULL,
        linked_account_id CHAR(36) NOT NULL,
        account_name VARCHAR(191) NULL,
        account_key VARCHAR(191) NULL,
        account_status VARCHAR(64) NULL,
        label VARCHAR(191) NULL,
        base_currency VARCHAR(16) NOT NULL DEFAULT 'USD',
        starting_balance DECIMAL(30, 12) NOT NULL DEFAULT 100000,
        cash_balance DECIMAL(30, 12) NOT NULL DEFAULT 100000,
        equity DECIMAL(30, 12) NOT NULL DEFAULT 100000,
        used_margin DECIMAL(30, 12) NOT NULL DEFAULT 0,
        available_margin DECIMAL(30, 12) NOT NULL DEFAULT 100000,
        open_positions INT NOT NULL DEFAULT 0,
        closed_positions INT NOT NULL DEFAULT 0,
        realized_pnl DECIMAL(30, 12) NOT NULL DEFAULT 0,
        unrealized_pnl DECIMAL(30, 12) NOT NULL DEFAULT 0,
        observed_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_paper_accounts_user_route (user_id, linked_account_id),
        KEY idx_paper_accounts_user_broker (user_id, broker_key),
        KEY idx_paper_accounts_user_observed (user_id, observed_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const resetAtColumns = await coreDataSource.query(
      "SHOW COLUMNS FROM paper_accounts LIKE 'reset_at'"
    );
    if (!Array.isArray(resetAtColumns) || !resetAtColumns.length) {
      try {
        await coreDataSource.query(
          'ALTER TABLE paper_accounts ADD COLUMN reset_at TIMESTAMP NULL AFTER observed_at'
        );
      } catch (error) {
        if ((error as { code?: string } | null)?.code !== 'ER_DUP_FIELDNAME') {
          throw error;
        }
      }
    }

    await coreDataSource.query(`
      CREATE TABLE IF NOT EXISTS paper_position_read_models (
        id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        paper_account_id CHAR(36) NOT NULL,
        paper_order_id CHAR(36) NOT NULL,
        suggested_trade_id CHAR(36) NULL,
        broker_key VARCHAR(100) NOT NULL,
        linked_account_id CHAR(36) NOT NULL,
        account_name VARCHAR(191) NULL,
        account_key VARCHAR(191) NULL,
        account_status VARCHAR(64) NULL,
        symbol VARCHAR(64) NOT NULL,
        side VARCHAR(16) NOT NULL,
        side_key VARCHAR(16) NOT NULL,
        status VARCHAR(32) NOT NULL,
        status_key VARCHAR(32) NOT NULL,
        execution_state VARCHAR(64) NULL,
        quantity DECIMAL(30, 12) NOT NULL DEFAULT 0,
        entry_price DECIMAL(30, 12) NULL,
        current_price DECIMAL(30, 12) NULL,
        exit_price DECIMAL(30, 12) NULL,
        stop_loss_price DECIMAL(30, 12) NULL,
        take_profit_price DECIMAL(30, 12) NULL,
        leverage DOUBLE NULL,
        liquidation_price DECIMAL(30, 12) NULL,
        exposure DECIMAL(30, 12) NULL,
        unrealized_pnl DECIMAL(30, 12) NULL,
        realized_pnl DECIMAL(30, 12) NULL,
        outcome VARCHAR(32) NULL,
        close_reason VARCHAR(64) NULL,
        observation_source VARCHAR(32) NULL,
        payload_json JSON NULL,
        created_at TIMESTAMP NOT NULL,
        opened_at TIMESTAMP NULL,
        updated_at TIMESTAMP NOT NULL,
        closed_at TIMESTAMP NULL,
        first_seen_at TIMESTAMP NULL,
        last_seen_at TIMESTAMP NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_paper_position_read_models_order (paper_order_id),
        KEY idx_paper_position_read_models_user_status_seen (user_id, status_key, last_seen_at),
        KEY idx_paper_position_read_models_user_account_status_seen (user_id, linked_account_id, status_key, last_seen_at),
        KEY idx_paper_position_read_models_user_closed_at (user_id, closed_at),
        KEY idx_paper_position_read_models_user_symbol (user_id, symbol)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await coreDataSource.query(`
      CREATE TABLE IF NOT EXISTS paper_position_events (
        id VARCHAR(128) NOT NULL,
        user_id CHAR(36) NOT NULL,
        paper_account_id CHAR(36) NOT NULL,
        paper_position_id CHAR(36) NULL,
        paper_order_id CHAR(36) NOT NULL,
        broker_key VARCHAR(100) NOT NULL,
        linked_account_id CHAR(36) NOT NULL,
        symbol VARCHAR(64) NULL,
        side VARCHAR(16) NULL,
        event_type VARCHAR(64) NOT NULL,
        price DECIMAL(30, 12) NULL,
        quantity DECIMAL(30, 12) NULL,
        realized_pnl_delta DECIMAL(30, 12) NULL,
        equity_after DECIMAL(30, 12) NULL,
        occurred_at TIMESTAMP NOT NULL,
        payload_json JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_paper_position_events_user_occurred (user_id, occurred_at),
        KEY idx_paper_position_events_position_occurred (paper_position_id, occurred_at),
        KEY idx_paper_position_events_order_occurred (paper_order_id, occurred_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    this.storageReady = true;
  }

  async replaceUserReadModel(
    userId: string,
    payload: {
      accounts: PaperAccountReadModelRow[];
      positions: PaperPositionReadModelRow[];
      events: PaperPositionEventRow[];
    }
  ): Promise<void> {
    await this.ensureStorage();

    const queryRunner = coreDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.query('DELETE FROM paper_position_events WHERE user_id = ?', [userId]);
      await queryRunner.query('DELETE FROM paper_position_read_models WHERE user_id = ?', [userId]);
      await queryRunner.query('DELETE FROM paper_accounts WHERE user_id = ?', [userId]);

      for (const account of payload.accounts) {
        await this.insertAccount(queryRunner, account);
      }

      for (const position of payload.positions) {
        await this.insertPosition(queryRunner, position);
      }

      for (const event of payload.events) {
        await this.insertEvent(queryRunner, event);
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async listAccounts(userId: string): Promise<PaperAccountReadModelRow[]> {
    await this.ensureStorage();
    const rows = (await coreDataSource.query(
      `SELECT
         id,
         user_id AS userId,
         broker_key AS brokerKey,
         linked_account_id AS linkedAccountId,
         account_name AS accountName,
         account_key AS accountKey,
         account_status AS accountStatus,
         label,
         base_currency AS baseCurrency,
         starting_balance AS startingBalance,
         cash_balance AS cashBalance,
         equity,
         used_margin AS usedMargin,
         available_margin AS availableMargin,
         open_positions AS openPositions,
         closed_positions AS closedPositions,
         realized_pnl AS realizedPnl,
         unrealized_pnl AS unrealizedPnl,
         observed_at AS observedAt,
         reset_at AS resetAt,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM paper_accounts
       WHERE user_id = ?
       ORDER BY broker_key ASC, account_name ASC, linked_account_id ASC`,
      [userId]
    )) as PaperAccountReadModelRow[];

    return rows;
  }

  async getAccountByLinkedAccountId(
    userId: string,
    linkedAccountId: string
  ): Promise<PaperAccountReadModelRow | null> {
    await this.ensureStorage();
    const rows = (await coreDataSource.query(
      `SELECT
         id,
         user_id AS userId,
         broker_key AS brokerKey,
         linked_account_id AS linkedAccountId,
         account_name AS accountName,
         account_key AS accountKey,
         account_status AS accountStatus,
         label,
         base_currency AS baseCurrency,
         starting_balance AS startingBalance,
         cash_balance AS cashBalance,
         equity,
         used_margin AS usedMargin,
         available_margin AS availableMargin,
         open_positions AS openPositions,
         closed_positions AS closedPositions,
         realized_pnl AS realizedPnl,
         unrealized_pnl AS unrealizedPnl,
         observed_at AS observedAt,
         reset_at AS resetAt,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM paper_accounts
       WHERE user_id = ? AND linked_account_id = ?
       LIMIT 1`,
      [userId, linkedAccountId]
    )) as PaperAccountReadModelRow[];

    return rows[0] || null;
  }

  async updateAccountSettings(
    userId: string,
    linkedAccountId: string,
    payload: {
      startingBalance?: number;
      resetAt?: Date | null;
    }
  ): Promise<void> {
    await this.ensureStorage();

    const updates: string[] = [];
    const values: unknown[] = [];

    if (payload.startingBalance !== undefined) {
      updates.push('starting_balance = ?');
      values.push(payload.startingBalance);
    }

    if (payload.resetAt !== undefined) {
      updates.push('reset_at = ?');
      values.push(payload.resetAt);
    }

    if (!updates.length) {
      return;
    }

    await coreDataSource.query(
      `UPDATE paper_accounts
       SET ${updates.join(', ')}
       WHERE user_id = ? AND linked_account_id = ?`,
      [...values, userId, linkedAccountId]
    );
  }

  async listPositions(
    userId: string,
    options: PaperPositionListOptions = {}
  ): Promise<PaperPositionReadModelRow[]> {
    await this.ensureStorage();

    const clauses = ['user_id = ?'];
    const values: unknown[] = [userId];

    if (options.brokerKey) {
      clauses.push('LOWER(broker_key) = ?');
      values.push(String(options.brokerKey).trim().toLowerCase());
    }

    if (options.accountId) {
      clauses.push('linked_account_id = ?');
      values.push(options.accountId);
    }

    if (options.statusKey) {
      clauses.push('status_key = ?');
      values.push(options.statusKey);
    }

    if (options.symbol) {
      clauses.push('UPPER(symbol) = ?');
      values.push(String(options.symbol).trim().toUpperCase());
    }

    if (options.startDate) {
      clauses.push('(closed_at IS NOT NULL AND closed_at >= ?)');
      values.push(options.startDate);
    }

    if (options.endDate) {
      clauses.push('(closed_at IS NOT NULL AND closed_at <= ?)');
      values.push(options.endDate);
    }

    const limit =
      Number.isFinite(Number(options.limit)) && Number(options.limit) > 0
        ? Math.floor(Number(options.limit))
        : null;
    const offset =
      Number.isFinite(Number(options.offset)) && Number(options.offset) > 0
        ? Math.floor(Number(options.offset))
        : 0;

    const rows = (await coreDataSource.query(
      `SELECT
         id,
         user_id AS userId,
         paper_account_id AS paperAccountId,
         paper_order_id AS paperOrderId,
         suggested_trade_id AS suggestedTradeId,
         broker_key AS brokerKey,
         linked_account_id AS linkedAccountId,
         account_name AS accountName,
         account_key AS accountKey,
         account_status AS accountStatus,
         symbol,
         side,
         side_key AS sideKey,
         status,
         status_key AS statusKey,
         execution_state AS executionState,
         quantity,
         entry_price AS entryPrice,
         current_price AS currentPrice,
         exit_price AS exitPrice,
         stop_loss_price AS stopLossPrice,
         take_profit_price AS takeProfitPrice,
         leverage,
         liquidation_price AS liquidationPrice,
         exposure,
         unrealized_pnl AS unrealizedPnl,
         realized_pnl AS realizedPnl,
         outcome,
         close_reason AS closeReason,
         observation_source AS observationSource,
         payload_json AS payload,
         created_at AS createdAt,
         opened_at AS openedAt,
         updated_at AS updatedAt,
         closed_at AS closedAt,
         first_seen_at AS firstSeenAt,
         last_seen_at AS lastSeenAt
       FROM paper_position_read_models
       WHERE ${clauses.join(' AND ')}
       ORDER BY
         CASE WHEN status_key = 'open' THEN COALESCE(last_seen_at, updated_at, created_at) ELSE COALESCE(closed_at, updated_at, created_at) END DESC
       ${limit ? `LIMIT ${limit}` : ''}
       ${offset ? `OFFSET ${offset}` : ''}`,
      values
    )) as PaperPositionReadModelRow[];

    return rows;
  }

  async getPositionById(
    userId: string,
    positionId: string
  ): Promise<PaperPositionReadModelRow | null> {
    await this.ensureStorage();
    const rows = (await coreDataSource.query(
      `SELECT
         id,
         user_id AS userId,
         paper_account_id AS paperAccountId,
         paper_order_id AS paperOrderId,
         suggested_trade_id AS suggestedTradeId,
         broker_key AS brokerKey,
         linked_account_id AS linkedAccountId,
         account_name AS accountName,
         account_key AS accountKey,
         account_status AS accountStatus,
         symbol,
         side,
         side_key AS sideKey,
         status,
         status_key AS statusKey,
         execution_state AS executionState,
         quantity,
         entry_price AS entryPrice,
         current_price AS currentPrice,
         exit_price AS exitPrice,
         stop_loss_price AS stopLossPrice,
         take_profit_price AS takeProfitPrice,
         leverage,
         liquidation_price AS liquidationPrice,
         exposure,
         unrealized_pnl AS unrealizedPnl,
         realized_pnl AS realizedPnl,
         outcome,
         close_reason AS closeReason,
         observation_source AS observationSource,
         payload_json AS payload,
         created_at AS createdAt,
         opened_at AS openedAt,
         updated_at AS updatedAt,
         closed_at AS closedAt,
         first_seen_at AS firstSeenAt,
         last_seen_at AS lastSeenAt
       FROM paper_position_read_models
       WHERE user_id = ? AND id = ?
       LIMIT 1`,
      [userId, positionId]
    )) as PaperPositionReadModelRow[];

    return rows[0] || null;
  }

  async listEventsByPositionId(
    userId: string,
    paperPositionId: string
  ): Promise<PaperPositionEventRow[]> {
    await this.ensureStorage();
    const rows = (await coreDataSource.query(
      `SELECT
         id,
         user_id AS userId,
         paper_account_id AS paperAccountId,
         paper_position_id AS paperPositionId,
         paper_order_id AS paperOrderId,
         broker_key AS brokerKey,
         linked_account_id AS linkedAccountId,
         symbol,
         side,
         event_type AS eventType,
         price,
         quantity,
         realized_pnl_delta AS realizedPnlDelta,
         equity_after AS equityAfter,
         occurred_at AS occurredAt,
         payload_json AS payload
       FROM paper_position_events
       WHERE user_id = ? AND paper_position_id = ?
       ORDER BY occurred_at DESC`,
      [userId, paperPositionId]
    )) as PaperPositionEventRow[];

    return rows;
  }

  private async insertAccount(
    queryRunner: QueryRunner,
    account: PaperAccountReadModelRow
  ): Promise<void> {
    await queryRunner.query(
      `INSERT INTO paper_accounts (
         id,
         user_id,
         broker_key,
         linked_account_id,
         account_name,
         account_key,
         account_status,
         label,
         base_currency,
         starting_balance,
         cash_balance,
         equity,
         used_margin,
         available_margin,
         open_positions,
         closed_positions,
         realized_pnl,
         unrealized_pnl,
         observed_at,
         reset_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        account.id,
        account.userId,
        account.brokerKey,
        account.linkedAccountId,
        account.accountName,
        account.accountKey,
        account.accountStatus,
        account.label,
        account.baseCurrency,
        account.startingBalance,
        account.cashBalance,
        account.equity,
        account.usedMargin,
        account.availableMargin,
        account.openPositions,
        account.closedPositions,
        account.realizedPnl,
        account.unrealizedPnl,
        account.observedAt,
        account.resetAt ?? null,
      ]
    );
  }

  private async insertPosition(
    queryRunner: QueryRunner,
    position: PaperPositionReadModelRow
  ): Promise<void> {
    await queryRunner.query(
      `INSERT INTO paper_position_read_models (
         id,
         user_id,
         paper_account_id,
         paper_order_id,
         suggested_trade_id,
         broker_key,
         linked_account_id,
         account_name,
         account_key,
         account_status,
         symbol,
         side,
         side_key,
         status,
         status_key,
         execution_state,
         quantity,
         entry_price,
         current_price,
         exit_price,
         stop_loss_price,
         take_profit_price,
         leverage,
         liquidation_price,
         exposure,
         unrealized_pnl,
         realized_pnl,
         outcome,
         close_reason,
         observation_source,
         payload_json,
         created_at,
         opened_at,
         updated_at,
         closed_at,
         first_seen_at,
         last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        position.id,
        position.userId,
        position.paperAccountId,
        position.paperOrderId,
        position.suggestedTradeId,
        position.brokerKey,
        position.linkedAccountId,
        position.accountName,
        position.accountKey,
        position.accountStatus,
        position.symbol,
        position.side,
        position.sideKey,
        position.status,
        position.statusKey,
        position.executionState,
        position.quantity,
        position.entryPrice,
        position.currentPrice,
        position.exitPrice,
        position.stopLossPrice,
        position.takeProfitPrice,
        position.leverage,
        position.liquidationPrice,
        position.exposure,
        position.unrealizedPnl,
        position.realizedPnl,
        position.outcome,
        position.closeReason,
        position.observationSource,
        position.payload ? JSON.stringify(position.payload) : null,
        position.createdAt,
        position.openedAt,
        position.updatedAt,
        position.closedAt,
        position.firstSeenAt,
        position.lastSeenAt,
      ]
    );
  }

  private async insertEvent(
    queryRunner: QueryRunner,
    event: PaperPositionEventRow
  ): Promise<void> {
    await queryRunner.query(
      `INSERT INTO paper_position_events (
         id,
         user_id,
         paper_account_id,
         paper_position_id,
         paper_order_id,
         broker_key,
         linked_account_id,
         symbol,
         side,
         event_type,
         price,
         quantity,
         realized_pnl_delta,
         equity_after,
         occurred_at,
         payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.userId,
        event.paperAccountId,
        event.paperPositionId,
        event.paperOrderId,
        event.brokerKey,
        event.linkedAccountId,
        event.symbol,
        event.side,
        event.eventType,
        event.price,
        event.quantity,
        event.realizedPnlDelta,
        event.equityAfter,
        event.occurredAt,
        event.payload ? JSON.stringify(event.payload) : null,
      ]
    );
  }
}
