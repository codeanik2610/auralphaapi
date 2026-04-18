import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../../../api';
import { MudrexLeverage, MudrexLeveragePayload } from '../../../api';
import { BadGatewayAppError } from '../../../api';
import { successResponse } from '../../../api';
import { validateAssetId, validateAssetSymbol } from '../../../api/validators/assets.validator';
import { BrokerAccountRepository } from '../../../database';
import { decryptBrokerAccountSettings } from '../../../lib/brokerAccountSecrets';
import { rethrowMudrexError } from './MudrexErrorMapper';
import { MudrexHttpClient } from './MudrexHttpClient';

@Service()
export class LeverageService {
  @Inject(() => MudrexHttpClient)
  private mudrexHttpClient!: MudrexHttpClient;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  async getLeverageByAssetId(assetId: string): Promise<ApiSuccessResponse<MudrexLeverage>> {
    const validatedAssetId = validateAssetId(assetId);

    try {
      const data = await this.fetchLeverageByAssetId(validatedAssetId);
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex leverage service');
    }
  }

  async getLeverageBySymbol(symbol: string): Promise<ApiSuccessResponse<MudrexLeverage>> {
    const validatedSymbol = validateAssetSymbol(symbol);

    try {
      const data = await this.fetchLeverageBySymbol(validatedSymbol);
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex leverage symbol service');
    }
  }

  private async fetchLeverageByAssetId(assetId: string): Promise<MudrexLeverage> {
    const payload = await this.requestLeverage<MudrexLeveragePayload>(
      `/fapi/v1/futures/${encodeURIComponent(assetId)}/leverage`
    );

    if (!payload || typeof payload !== 'object') {
      throw new BadGatewayAppError('Mudrex returned an invalid leverage payload');
    }

    return this.mapLeveragePayload(payload);
  }

  private async fetchLeverageBySymbol(symbol: string): Promise<MudrexLeverage> {
    const payload = await this.requestLeverage<MudrexLeveragePayload>(
      `/fapi/v1/futures/${encodeURIComponent(symbol)}/leverage?is_symbol`
    );

    if (!payload || typeof payload !== 'object') {
      throw new BadGatewayAppError('Mudrex returned an invalid leverage payload');
    }

    return this.mapLeveragePayload(payload);
  }

  private mapLeveragePayload(payload: MudrexLeveragePayload): MudrexLeverage {
    return {
      Leverage: payload.leverage,
      MarginType: payload.margin_type,
    };
  }

  private async requestLeverage<T>(path: string): Promise<T> {
    const settings = await this.getSystemMudrexSettings();
    if (settings) {
      return this.mudrexHttpClient.authenticatedGetWithSettings<T>(settings, path, undefined, 'mudrex');
    }

    return this.mudrexHttpClient.get<T>(path);
  }

  private async getSystemMudrexSettings(): Promise<Record<string, unknown> | null> {
    const systemAccounts = await this.brokerAccountRepository.listSystemBrokerAccounts({
      brokerKey: 'mudrex',
      statuses: ['Connected', 'Idle'],
    });

    for (const account of systemAccounts) {
      const decrypted = decryptBrokerAccountSettings(
        ((account.settings ?? {}) as Record<string, unknown>)
      );
      if (decrypted && String(decrypted.apiSecret || '').trim()) {
        return decrypted;
      }
    }

    return null;
  }
}
