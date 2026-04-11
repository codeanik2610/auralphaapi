import {
  AddMarginBody,
  ClosePartialPositionBody,
  CreateRiskOrderBody,
  PositionLiqPriceQuery,
  PositionsHistoryQuery,
  UpdateRiskOrderBody,
} from '../../../api/validators/positions.validator';

export interface BrokerPositionContext {
  userId?: string;
  brokerKey?: string;
  accountId?: string;
}

export interface ValidatedPositionsRouteQuery {
  limit?: number;
}

export interface BrokerPositionsAdapter {
  getPositions(
    query: ValidatedPositionsRouteQuery,
    context?: BrokerPositionContext
  ): Promise<unknown>;
  getLiquidationPrice(
    positionId: string,
    query: PositionLiqPriceQuery,
    context?: BrokerPositionContext
  ): Promise<unknown>;
  addMargin(
    positionId: string,
    body: AddMarginBody,
    context?: BrokerPositionContext
  ): Promise<unknown>;
  createRiskOrder(
    positionId: string,
    body: CreateRiskOrderBody,
    context?: BrokerPositionContext
  ): Promise<unknown>;
  updateRiskOrder(
    positionId: string,
    body: UpdateRiskOrderBody,
    context?: BrokerPositionContext
  ): Promise<unknown>;
  reversePosition(positionId: string, context?: BrokerPositionContext): Promise<unknown>;
  closePartial(
    positionId: string,
    body: ClosePartialPositionBody,
    context?: BrokerPositionContext
  ): Promise<unknown>;
  closePosition(positionId: string, context?: BrokerPositionContext): Promise<unknown>;
  getPositionHistory(
    query: PositionsHistoryQuery,
    context?: BrokerPositionContext
  ): Promise<unknown>;
  getClosingFills?(
    productIds: string[],
    context?: BrokerPositionContext
  ): Promise<Map<string, { closePrice: number; closedAt: string; fillType: string | null }> | undefined>;
}
