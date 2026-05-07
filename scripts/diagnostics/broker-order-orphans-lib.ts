import { coreDataSource } from '../../src/database/data-source';

export type OrphanKind = 'orphan_entry' | 'orphan_protection' | 'orphan_other';

export type OrphanOrderRow = {
  brokerKey: string;
  accountId: string;
  accountName: string | null;
  userId: string;
  symbol: string;
  externalId: string;
  orderStatus: string | null;
  statusRank: number | null;
  price: string | null;
  quantity: string | null;
  filledQuantity: string | null;
  side: string | null;
  marker: string | null;
  lastSeenAt: Date | string | null;
};

export type OrphanOrderItem = {
  brokerKey: string;
  accountId: string;
  accountName: string | null;
  userId: string;
  symbol: string;
  externalId: string;
  kind: OrphanKind;
  orderStatus: string | null;
  price: string | null;
  quantity: string | null;
  filledQuantity: string | null;
  side: string | null;
  lastSeenAt: string | null;
  recommendation: string;
};

function readString(value: unknown): string {
  return String(value || '').trim();
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function classifyBrokerOrderOrphan(row: Pick<OrphanOrderRow, 'marker'>): OrphanKind {
  const marker = readString(row.marker).toLowerCase();
  if (
    marker.includes('stop_loss') ||
    marker.includes('stoploss') ||
    marker.includes('take_profit') ||
    marker.includes('takeprofit')
  ) {
    return 'orphan_protection';
  }
  if (
    marker.includes('limit_order') ||
    marker.includes('market_order') ||
    marker === 'long' ||
    marker === 'short'
  ) {
    return 'orphan_entry';
  }
  return 'orphan_other';
}

export function brokerOrderOrphanRecommendation(kind: OrphanKind): string {
  if (kind === 'orphan_protection') {
    return 'Cancel at broker if no matching live position exists, then allow order sync to close the DB snapshot.';
  }
  if (kind === 'orphan_entry') {
    return 'Cancel if not tied to an active automation/execution; block new entries on this route until reviewed.';
  }
  return 'Review manually before taking broker action.';
}

export async function loadBrokerOrderOrphans(): Promise<OrphanOrderItem[]> {
  const rows = (await coreDataSource.query(
    `WITH open_orders AS (
       SELECT o.user_id AS userId,
              o.account_id AS accountId,
              o.broker_key AS brokerKey,
              ba.accountName AS accountName,
              o.symbol,
              o.external_id AS externalId,
              o.order_status AS orderStatus,
              o.status_rank AS statusRank,
              COALESCE(
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.payload_json, '$.price')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.payload_json, '$.stop_price')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.payload_json, '$.trigger_price')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.payload_json, '$.limit_price')), 'null'), '')
              ) AS price,
              COALESCE(
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.payload_json, '$.quantity')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.payload_json, '$.size')), 'null'), '')
              ) AS quantity,
              COALESCE(
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.payload_json, '$.filled_quantity')), 'null'), ''),
                NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.payload_json, '$.filledQuantity')), 'null'), '')
              ) AS filledQuantity,
              NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.payload_json, '$.side')), 'null'), '') AS side,
              LOWER(CONCAT_WS(' ',
                JSON_UNQUOTE(JSON_EXTRACT(o.payload_json, '$.stop_order_type')),
                JSON_UNQUOTE(JSON_EXTRACT(o.payload_json, '$.order_type')),
                JSON_UNQUOTE(JSON_EXTRACT(o.payload_json, '$.type')),
                JSON_UNQUOTE(JSON_EXTRACT(o.payload_json, '$.client_order_id')),
                JSON_UNQUOTE(JSON_EXTRACT(o.payload_json, '$.reduce_only')),
                JSON_UNQUOTE(JSON_EXTRACT(o.payload_json, '$.side'))
              )) AS marker,
              o.last_seen_at AS lastSeenAt
         FROM scheduler_orders_snapshots o
         LEFT JOIN broker_accounts ba
           ON ba.id = o.account_id
        WHERE o.status_rank > 0
          AND o.status_rank <= 2
     ),
     open_positions AS (
       SELECT user_id AS userId,
              account_id AS accountId,
              LOWER(broker_key) AS brokerKey,
              symbol
         FROM position_read_models
        WHERE status_rank > 0
          AND status_rank <= 2
     )
     SELECT oo.*
       FROM open_orders oo
       LEFT JOIN open_positions op
         ON op.userId = oo.userId
        AND op.accountId = oo.accountId
        AND op.brokerKey = LOWER(oo.brokerKey)
        AND LOWER(COALESCE(op.symbol, '')) = LOWER(COALESCE(oo.symbol, ''))
      WHERE op.symbol IS NULL
      ORDER BY oo.brokerKey, oo.symbol, oo.externalId`
  )) as OrphanOrderRow[];

  return rows.map((row) => {
    const kind = classifyBrokerOrderOrphan(row);
    return {
      brokerKey: row.brokerKey,
      accountId: row.accountId,
      accountName: row.accountName,
      userId: row.userId,
      symbol: row.symbol,
      externalId: row.externalId,
      kind,
      orderStatus: row.orderStatus,
      price: row.price,
      quantity: row.quantity,
      filledQuantity: row.filledQuantity,
      side: row.side,
      lastSeenAt: iso(row.lastSeenAt),
      recommendation: brokerOrderOrphanRecommendation(kind),
    };
  });
}
