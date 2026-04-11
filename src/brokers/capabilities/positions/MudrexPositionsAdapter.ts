import { Inject, Service } from 'typedi';
import { PositionsService } from '../../providers/mudrex';
import {
  AddMarginBody,
  ClosePartialPositionBody,
  CreateRiskOrderBody,
  PositionLiqPriceQuery,
  PositionsHistoryQuery,
  UpdateRiskOrderBody,
} from '../../../api/validators/positions.validator';
import { BrokerPositionContext, BrokerPositionsAdapter, ValidatedPositionsRouteQuery } from './types';

@Service()
export class MudrexPositionsAdapter implements BrokerPositionsAdapter {
  @Inject(() => PositionsService)
  private positionsService!: PositionsService;

  async getPositions(
    query: ValidatedPositionsRouteQuery,
    context?: BrokerPositionContext
  ): Promise<unknown> {
    return this.positionsService.getFuturesPositions(
      { ...(query.limit ? { limit: query.limit } : {}) },
      context?.userId,
      context?.accountId
    );
  }

  async getLiquidationPrice(
    positionId: string,
    query: PositionLiqPriceQuery,
    context?: BrokerPositionContext
  ): Promise<unknown> {
    return this.positionsService.getPositionLiquidationPrice(
      positionId,
      query,
      context?.userId,
      context?.accountId
    );
  }

  async addMargin(
    positionId: string,
    body: AddMarginBody,
    context?: BrokerPositionContext
  ): Promise<unknown> {
    return this.positionsService.addPositionMargin(positionId, body, context?.userId, context?.accountId);
  }

  async createRiskOrder(
    positionId: string,
    body: CreateRiskOrderBody,
    context?: BrokerPositionContext
  ): Promise<unknown> {
    return this.positionsService.createPositionRiskOrder(
      positionId,
      body,
      context?.userId,
      context?.accountId
    );
  }

  async updateRiskOrder(
    positionId: string,
    body: UpdateRiskOrderBody,
    context?: BrokerPositionContext
  ): Promise<unknown> {
    return this.positionsService.updatePositionRiskOrder(
      positionId,
      body,
      context?.userId,
      context?.accountId
    );
  }

  async reversePosition(positionId: string, context?: BrokerPositionContext): Promise<unknown> {
    return this.positionsService.reversePosition(positionId, context?.userId, context?.accountId);
  }

  async closePartial(
    positionId: string,
    body: ClosePartialPositionBody,
    context?: BrokerPositionContext
  ): Promise<unknown> {
    return this.positionsService.closePositionPartial(
      positionId,
      body,
      context?.userId,
      context?.accountId
    );
  }

  async closePosition(positionId: string, context?: BrokerPositionContext): Promise<unknown> {
    return this.positionsService.closePosition(positionId, context?.userId, context?.accountId);
  }

  async getPositionHistory(
    query: PositionsHistoryQuery,
    context?: BrokerPositionContext
  ): Promise<unknown> {
    return this.positionsService.getPositionHistory(query, context?.userId, context?.accountId);
  }
}
